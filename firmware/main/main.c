// First app for the ESP32-2432S028R ("Cheap Yellow Display"):
// shows the picture or GIF baked into images/picture.bin.
//
// To use your own picture, run tools/img2cyd.py (see firmware/README.md) and
// build again.

#include <stdio.h>
#include "board_cyd.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_lcd_ili9341.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "picture_player.h"

static const char *TAG = "cyd";

// Turn the menuconfig switches (defined or not) into true/false.
#ifdef CONFIG_CYD_LCD_INVERT_COLORS
#define LCD_INVERT true
#else
#define LCD_INVERT false
#endif
#ifdef CONFIG_CYD_LCD_MIRROR_X
#define LCD_MIRROR_X true
#else
#define LCD_MIRROR_X false
#endif
#ifdef CONFIG_CYD_LCD_MIRROR_Y
#define LCD_MIRROR_Y true
#else
#define LCD_MIRROR_Y false
#endif

extern const uint8_t picture_bin_start[] asm("_binary_picture_bin_start");
extern const uint8_t picture_bin_end[] asm("_binary_picture_bin_end");

static esp_lcd_panel_handle_t screen_init(void)
{
    gpio_config_t bl = {
        .pin_bit_mask = 1ULL << CYD_LCD_PIN_BL,
        .mode = GPIO_MODE_OUTPUT,
    };
    ESP_ERROR_CHECK(gpio_config(&bl));
    gpio_set_level(CYD_LCD_PIN_BL, 0); // keep dark until the first picture is up

    spi_bus_config_t bus = {
        .sclk_io_num = CYD_LCD_PIN_SCLK,
        .mosi_io_num = CYD_LCD_PIN_MOSI,
        .miso_io_num = CYD_LCD_PIN_MISO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = CYD_LCD_WIDTH * 20 * 2 + 8,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(CYD_LCD_SPI_HOST, &bus, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_cfg = {
        .cs_gpio_num = CYD_LCD_PIN_CS,
        .dc_gpio_num = CYD_LCD_PIN_DC,
        .spi_mode = 0,
        .pclk_hz = CONFIG_CYD_LCD_PIXEL_CLOCK_MHZ * 1000 * 1000,
        .trans_queue_depth = 4,
        .on_color_trans_done = cyd_picture_on_trans_done,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)CYD_LCD_SPI_HOST,
                                             &io_cfg, &io));

    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_panel_dev_config_t panel_cfg = {
        .reset_gpio_num = CYD_LCD_PIN_RST,
#if CONFIG_CYD_LCD_BGR
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
#else
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
#endif
        .bits_per_pixel = 16,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_ili9341(io, &panel_cfg, &panel));

    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, LCD_INVERT));
    // Landscape: swap rows and columns, then mirror as configured.
    ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_mirror(panel, LCD_MIRROR_X, LCD_MIRROR_Y));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
    return panel;
}

void app_main(void)
{
    ESP_ERROR_CHECK(cyd_picture_player_init());
    esp_lcd_panel_handle_t panel = screen_init();

    cyd_picture_t pic;
    esp_err_t err = cyd_picture_parse(picture_bin_start,
                                      picture_bin_end - picture_bin_start, &pic);
    if (err != ESP_OK) {
        // Show solid red so a bad picture file is obvious on the screen too.
        cyd_fill_screen(panel, 0xF800);
        gpio_set_level(CYD_LCD_PIN_BL, 1);
        ESP_LOGE(TAG, "picture.bin is not usable (%s). Re-run tools/img2cyd.py.",
                 esp_err_to_name(err));
        return;
    }
    ESP_LOGI(TAG, "picture: %ux%u, %u frame(s)", pic.width, pic.height, pic.frame_count);

    if (pic.width < CYD_LCD_WIDTH || pic.height < CYD_LCD_HEIGHT) {
        ESP_ERROR_CHECK(cyd_fill_screen(panel, 0x0000)); // black borders
    }
    ESP_ERROR_CHECK(cyd_picture_draw_frame(panel, &pic, 0));
    gpio_set_level(CYD_LCD_PIN_BL, 1);

    if (pic.frame_count == 1) {
        ESP_LOGI(TAG, "still picture shown");
        return;
    }

    // Animation: hold each frame for its GIF delay, then show the next one.
    // Loops forever.
    uint16_t i = 0;
    while (true) {
        vTaskDelay(pdMS_TO_TICKS(cyd_picture_delay_ms(&pic, i)) ?: 1);
        i = (i + 1) % pic.frame_count;
        ESP_ERROR_CHECK(cyd_picture_draw_frame(panel, &pic, i));
    }
}
