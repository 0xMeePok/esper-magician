// Picture and GIF player for the ESPER screens:
//   - 2.8-inch ESP32-2432S028R ("Cheap Yellow Display", 320x240, ILI9341)
//   - 1.9-inch ST7789 (170x320) on an ESP32 DevKit
//
// Pick the board in `idf.py menuconfig` -> "ESPER screen". Its pins are in
// board_cyd.h or board_devkit_st7789.h.
//
// Shows the picture or GIF baked into images/<screen>/picture.bin. On a board
// with a picture button, each press switches between the picture and a colour
// test card.
//
// To use your own picture, run tools/img2cyd.py (see firmware/README.md) and
// build again.

#include <stdio.h>
#include "board.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "picture_player.h"
#include "test_card.h"

static const char *TAG = "esper";

#define POLL_MS 20 // how often the button is checked

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

extern const uint8_t picture_bin_start[] asm("_binary_picture_bin_start");
extern const uint8_t picture_bin_end[] asm("_binary_picture_bin_end");

static esp_lcd_panel_handle_t screen_init(void)
{
    gpio_config_t bl = {
        .pin_bit_mask = 1ULL << BOARD_LCD_PIN_BL,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&bl));
    gpio_set_level(BOARD_LCD_PIN_BL, 0); // keep dark until the first picture is up

    spi_bus_config_t bus = {
        .sclk_io_num = BOARD_LCD_PIN_SCLK,
        .mosi_io_num = BOARD_LCD_PIN_MOSI,
        .miso_io_num = BOARD_LCD_PIN_MISO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = BOARD_LCD_WIDTH * 20 * 2 + 8,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(BOARD_LCD_SPI_HOST, &bus, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = BOARD_LCD_PIN_CS,
        .dc_gpio_num = BOARD_LCD_PIN_DC,
        .spi_mode = 0,
        .pclk_hz = CONFIG_ESPER_SCREEN_PIXEL_CLOCK_MHZ * 1000 * 1000,
        .trans_queue_depth = 4,
        .on_color_trans_done = cyd_picture_on_trans_done,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)BOARD_LCD_SPI_HOST,
                                             &io_cfg, &io));

    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = BOARD_LCD_PIN_RST,
#if CONFIG_ESPER_SCREEN_BGR
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
#else
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
#endif
        .bits_per_pixel = 16,
    };
    ESP_ERROR_CHECK(board_lcd_new_panel(io, &panel_cfg, &panel));

    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, LCD_INVERT));
    ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(panel, BOARD_LCD_SWAP_XY));
    ESP_ERROR_CHECK(esp_lcd_panel_mirror(panel, LCD_MIRROR_X, LCD_MIRROR_Y));
    ESP_ERROR_CHECK(esp_lcd_panel_set_gap(panel, BOARD_LCD_GAP_X, BOARD_LCD_GAP_Y));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
    return panel;
}

#if BOARD_HAS_BUTTON
static void button_init(void)
{
    gpio_config_t btn = {
        .pin_bit_mask = 1ULL << BOARD_PIN_BUTTON,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn));
}

// True once for each press. The button reads 0 while held.
static bool button_was_pressed(void)
{
    static int last = 1;
    int level = gpio_get_level(BOARD_PIN_BUTTON);
    bool pressed = false;
    if (level == 0 && last == 1) {
        vTaskDelay(pdMS_TO_TICKS(30) ?: 1); // let the contacts settle
        pressed = gpio_get_level(BOARD_PIN_BUTTON) == 0;
        level = pressed ? 0 : 1;
    }
    last = level;
    return pressed;
}
#endif

// Waits `ms`, or less if the button is pressed. Returns true on a press.
static bool wait_for_press(uint32_t ms)
{
#if BOARD_HAS_BUTTON
    TickType_t start = xTaskGetTickCount();
    do {
        if (button_was_pressed()) {
            return true;
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_MS) ?: 1);
    } while (pdTICKS_TO_MS(xTaskGetTickCount() - start) < ms);
    return false;
#else
    vTaskDelay(pdMS_TO_TICKS(ms) ?: 1);
    return false;
#endif
}

// Draws the picture's first frame, or solid red if the picture is unusable
// so the problem is obvious on the screen too.
static void show_picture(esp_lcd_panel_handle_t panel, const cyd_picture_t *pic)
{
    if (!pic) {
        ESP_ERROR_CHECK(cyd_fill_screen(panel, 0xF800));
        return;
    }
    if (pic->width < BOARD_LCD_WIDTH || pic->height < BOARD_LCD_HEIGHT) {
        ESP_ERROR_CHECK(cyd_fill_screen(panel, 0x0000)); // black borders
    }
    ESP_ERROR_CHECK(cyd_picture_draw_frame(panel, pic, 0));
}

void app_main(void)
{
    ESP_ERROR_CHECK(cyd_picture_player_init());
    esp_lcd_panel_handle_t panel = screen_init();
#if BOARD_HAS_BUTTON
    button_init();
#endif
    ESP_LOGI(TAG, "board: %s, %dx%d", BOARD_NAME, BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT);

    cyd_picture_t pic;
    esp_err_t err = cyd_picture_parse(picture_bin_start,
                                      picture_bin_end - picture_bin_start, &pic);
    const cyd_picture_t *picture = err == ESP_OK ? &pic : NULL;
    if (picture) {
        ESP_LOGI(TAG, "picture: %ux%u, %u frame(s)", pic.width, pic.height, pic.frame_count);
    } else {
        ESP_LOGE(TAG, "picture.bin is not usable (%s). Re-run tools/img2cyd.py "
                 "with the --screen for this board.", esp_err_to_name(err));
    }

    show_picture(panel, picture);
    gpio_set_level(BOARD_LCD_PIN_BL, 1);

    bool showing_card = false;
    uint16_t frame = 0;
    while (true) {
        bool animating = !showing_card && picture && picture->frame_count > 1;
        if (!animating && !BOARD_HAS_BUTTON) {
            ESP_LOGI(TAG, "still picture shown");
            return; // nothing left to do
        }

        // Hold this frame for its GIF delay (or just watch the button), then
        // either switch views or move to the next frame. Animations loop forever.
        uint32_t hold = animating ? cyd_picture_delay_ms(picture, frame) : POLL_MS;
        if (wait_for_press(hold)) {
            showing_card = !showing_card;
            frame = 0;
            if (showing_card) {
                ESP_ERROR_CHECK(test_card_draw(panel));
            } else {
                show_picture(panel, picture);
            }
            continue;
        }
        if (animating) {
            frame = (frame + 1) % picture->frame_count;
            ESP_ERROR_CHECK(cyd_picture_draw_frame(panel, picture, frame));
        }
    }
}
