#include "screen.h"

#include <string.h>
#include "board.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
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

static bool on_trans_done(esp_lcd_panel_io_handle_t io, esp_lcd_panel_io_event_data_t *edata,
                          void *user_ctx)
{
    BaseType_t woken = pdFALSE;
    xSemaphoreGiveFromISR(s_done, &woken);
    return woken == pdTRUE;
}

esp_err_t screen_init(void)
{
    gpio_config_t bl = {
        .pin_bit_mask = 1ULL << BOARD_LCD_PIN_BL,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&bl), TAG, "backlight pin");
    gpio_set_level(BOARD_LCD_PIN_BL, 0); // keep dark until the first picture is up

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

void screen_backlight(bool on)
{
    gpio_set_level(BOARD_LCD_PIN_BL, on ? 1 : 0);
}

static inline uint16_t to_be(uint16_t v)
{
    return (uint16_t)((v >> 8) | (v << 8));
}

// Sends rows double-buffered through DMA RAM. With `src`, each chunk is
// converted from host-order pixels; without it, the buffers already hold one
// colour and are sent as they are.
static esp_err_t send(int x, int y, int w, int h, const uint16_t *src, int src_stride)
{
    int rows_per_chunk = CHUNK_PIXELS / w;
    int in_flight = 0;
    int n = 0;
    esp_err_t err = ESP_OK;

    for (int row = 0; row < h && err == ESP_OK; row += rows_per_chunk, n++) {
        int count = h - row < rows_per_chunk ? h - row : rows_per_chunk;
        uint16_t *buf = s_buf[n & 1];
        if (in_flight == 2) {
            xSemaphoreTake(s_done, portMAX_DELAY); // the older transfer used this buffer
            in_flight--;
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
        if (err == ESP_OK) {
            in_flight++;
        }
    }
    while (in_flight--) {
        xSemaphoreTake(s_done, portMAX_DELAY);
    }
    return err;
}

esp_err_t screen_fill_rect(int x, int y, int w, int h, uint16_t rgb565)
{
    ESP_RETURN_ON_FALSE(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= BOARD_LCD_WIDTH &&
                        y + h <= BOARD_LCD_HEIGHT, ESP_ERR_INVALID_ARG, TAG, "rect off screen");
    uint16_t be = to_be(rgb565);
    for (int b = 0; b < 2; b++) {
        for (int i = 0; i < CHUNK_PIXELS; i++) {
            s_buf[b][i] = be;
        }
    }
    return send(x, y, w, h, NULL, 0);
}

esp_err_t screen_fill(uint16_t rgb565)
{
    return screen_fill_rect(0, 0, BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT, rgb565);
}

esp_err_t screen_draw(int x, int y, int w, int h, const uint16_t *px)
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
