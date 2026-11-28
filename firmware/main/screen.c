#include "screen.h"

#include <string.h>
#include "board.h"
#include "driver/ledc.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_log.h"
#include "esp_lcd_panel_ops.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "screen";

// Rows sent per SPI transfer. Two buffers of this size live in DMA RAM, so one
// can be filled while the other is going out to the screen.
#define CHUNK_ROWS 20
#define CHUNK_PIXELS (BOARD_LCD_WIDTH * CHUNK_ROWS)

// Turn the menuconfig switches (defined or not) into true/false.
#ifdef CONFIG_ESPER_SCREEN_INVERT_COLORS
#define LCD_INVERT true
#else
#define LCD_INVERT false
#endif
#ifdef CONFIG_ESPER_SCREEN_MIRROR_X
#define LCD_MIRROR_X true
#else
#define LCD_MIRROR_X false
#endif
#ifdef CONFIG_ESPER_SCREEN_MIRROR_Y
#define LCD_MIRROR_Y true
#else
#define LCD_MIRROR_Y false
#endif

static esp_lcd_panel_handle_t s_panel;
static uint16_t *s_buf[2];       // big-endian RGB565, as the screen wants it
static SemaphoreHandle_t s_done; // given once per finished transfer
static int s_in_flight;          // transfers queued and not yet finished
static int s_next_buf;           // which buffer the next chunk goes in

// The backlight is dimmed by switching it on and off 10,000 times a second
// (PWM); how much of the time it's on sets the brightness.
#define BL_MODE LEDC_LOW_SPEED_MODE
#define BL_TIMER LEDC_TIMER_0
#define BL_CHANNEL LEDC_CHANNEL_0
#define BL_BITS 10
#define BL_FULL (1 << BL_BITS) // on all the time
static bool s_bl_on;
static int s_bl_percent = 100;

static bool on_trans_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *edata,
                          void *user_ctx)
{
    BaseType_t woken = pdFALSE;
    xSemaphoreGiveFromISR(s_done, &woken);
    return woken == pdTRUE;
}

esp_err_t screen_init(void)
{
    ledc_timer_config_t bl_timer = {
        .speed_mode = BL_MODE,
        .duty_resolution = BL_BITS,
        .timer_num = BL_TIMER,
        .freq_hz = 10000,
        .clk_cfg = LEDC_AUTO_CLK,
    };
    ESP_RETURN_ON_ERROR(ledc_timer_config(&bl_timer), TAG, "backlight timer");
    ledc_channel_config_t bl = {
        .gpio_num = BOARD_LCD_PIN_BL,
        .speed_mode = BL_MODE,
        .channel = BL_CHANNEL,
        .timer_sel = BL_TIMER,
        .duty = 0, // keep dark until the first picture is up
    };
    ESP_RETURN_ON_ERROR(ledc_channel_config(&bl), TAG, "backlight pin");

    for (int i = 0; i < 2; i++) {
        s_buf[i] = heap_caps_malloc(CHUNK_PIXELS * 2, MALLOC_CAP_DMA);
        ESP_RETURN_ON_FALSE(s_buf[i], ESP_ERR_NO_MEM, TAG, "no DMA memory");
    }
    s_done = xSemaphoreCreateCounting(2, 0);
    ESP_RETURN_ON_FALSE(s_done, ESP_ERR_NO_MEM, TAG, "no semaphore");

    spi_bus_config_t bus = {
        .sclk_io_num = BOARD_LCD_PIN_SCLK,
        .mosi_io_num = BOARD_LCD_PIN_MOSI,
        .miso_io_num = BOARD_LCD_PIN_MISO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = CHUNK_PIXELS * 2 + 8,
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(BOARD_LCD_SPI_HOST, &bus, SPI_DMA_CH_AUTO), TAG, "spi");

    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = BOARD_LCD_PIN_CS,
        .dc_gpio_num = BOARD_LCD_PIN_DC,
        .spi_mode = 0,
        .pclk_hz = CONFIG_ESPER_SCREEN_PIXEL_CLOCK_MHZ * 1000 * 1000,
        .trans_queue_depth = 4,
        .on_color_trans_done = on_trans_done,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)BOARD_LCD_SPI_HOST,
                                                 &io_cfg, &io), TAG, "panel io");

    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = BOARD_LCD_PIN_RST,
#if CONFIG_ESPER_SCREEN_BGR
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
#else
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
#endif
        .bits_per_pixel = 16,
    };
    ESP_RETURN_ON_ERROR(board_lcd_new_panel(io, &panel_cfg, &s_panel), TAG, "panel");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(s_panel), TAG, "reset");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_init(s_panel), TAG, "init");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(s_panel, LCD_INVERT), TAG, "invert");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(s_panel, BOARD_LCD_SWAP_XY), TAG, "swap");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(s_panel, LCD_MIRROR_X, LCD_MIRROR_Y), TAG, "mirror");
    ESP_RETURN_ON_ERROR(esp_lcd_panel_set_gap(s_panel, BOARD_LCD_GAP_X, BOARD_LCD_GAP_Y), TAG, "gap");
    return esp_lcd_panel_disp_on_off(s_panel, true);
}

static void backlight_apply(void)
{
    // Eyes see brightness roughly as the square of the light, so 50% looks
    // half as bright (a quarter of the time on).
    uint32_t p = (uint32_t)s_bl_percent;
    uint32_t duty = s_bl_on ? (BL_FULL * p * p + 5000) / 10000 : 0;
    if (s_bl_on && duty == 0) {
        duty = 1;
    }
    ledc_set_duty(BL_MODE, BL_CHANNEL, duty);
    ledc_update_duty(BL_MODE, BL_CHANNEL);
}

void screen_backlight(bool on)
{
    s_bl_on = on;
    backlight_apply();
}

void screen_brightness(int percent)
{
    percent = percent < 1 ? 1 : percent > 100 ? 100 : percent;
    if (percent == s_bl_percent) {
        return;
    }
    s_bl_percent = percent;
    ESP_LOGI(TAG, "brightness %d%%", percent);
    backlight_apply();
}

static inline uint16_t to_be(uint16_t v)
{
    return (uint16_t)((v >> 8) | (v << 8));
}

void screen_wait(void)
{
    while (s_in_flight > 0) {
        xSemaphoreTake(s_done, portMAX_DELAY);
        s_in_flight--;
    }
}

// Queues rows double-buffered through DMA RAM, returning once the last chunk
// is queued (screen_wait() waits for it to go out). With `src`, each chunk is
// converted from host-order pixels; without it, the buffers already hold one
// colour and are sent as they are.
static esp_err_t send(int x, int y, int w, int h, const uint16_t *src, int src_stride)
{
    int rows_per_chunk = CHUNK_PIXELS / w;
    esp_err_t err = ESP_OK;

    for (int row = 0; row < h && err == ESP_OK; row += rows_per_chunk) {
        int count = h - row < rows_per_chunk ? h - row : rows_per_chunk;
        uint16_t *buf = s_buf[s_next_buf];
        if (s_in_flight == 2) {
            xSemaphoreTake(s_done, portMAX_DELAY); // the older transfer used this buffer
            s_in_flight--;
        }
        if (src) {
            for (int r = 0; r < count; r++) {
                const uint16_t *line = src + (size_t)(row + r) * src_stride;
                uint16_t *out = buf + r * w;
                for (int i = 0; i < w; i++) {
                    out[i] = to_be(line[i]);
                }
            }
        }
        err = esp_lcd_panel_draw_bitmap(s_panel, x, y + row, x + w, y + row + count, buf);
        s_next_buf ^= 1;
        if (err == ESP_OK) {
            s_in_flight++;
        }
    }
    return err;
}

esp_err_t screen_fill_rect(int x, int y, int w, int h, uint16_t rgb565)
{
    ESP_RETURN_ON_FALSE(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= BOARD_LCD_WIDTH &&
                        y + h <= BOARD_LCD_HEIGHT, ESP_ERR_INVALID_ARG, TAG, "rect off screen");
    screen_wait(); // both buffers are about to be refilled
    uint16_t be = to_be(rgb565);
    for (int b = 0; b < 2; b++) {
        for (int i = 0; i < CHUNK_PIXELS; i++) {
            s_buf[b][i] = be;
        }
    }
    esp_err_t err = send(x, y, w, h, NULL, 0);
    screen_wait();
    return err;
}

esp_err_t screen_fill(uint16_t rgb565)
{
    return screen_fill_rect(0, 0, BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT, rgb565);
}

esp_err_t screen_draw(int x, int y, int w, int h, const uint16_t *px)
{
    esp_err_t err = screen_draw_queued(x, y, w, h, px);
    screen_wait();
    return err;
}

esp_err_t screen_draw_queued(int x, int y, int w, int h, const uint16_t *px)
{
    int stride = w;
    if (x < 0) {
        px -= x;
        w += x;
        x = 0;
    }
    if (y < 0) {
        px -= (size_t)y * stride;
        h += y;
        y = 0;
    }
    if (x + w > BOARD_LCD_WIDTH) {
        w = BOARD_LCD_WIDTH - x;
    }
    if (y + h > BOARD_LCD_HEIGHT) {
        h = BOARD_LCD_HEIGHT - y;
    }
    if (w <= 0 || h <= 0) {
        return ESP_OK;
    }
    return send(x, y, w, h, px, stride);
}
