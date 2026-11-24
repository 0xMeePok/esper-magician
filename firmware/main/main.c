// ESPER player for the 1.9-inch ST7789 screen on an ESP32 DevKit.
//
// Shows the picture or GIF in the "media" partition. The website writes it
// over USB the first time, then over Wi-Fi: it hands the picture to a small
// page this player serves on the home network (web.c).
//
// Before anything has been sent, or if what's stored is damaged, the screen
// shows a colour test card. Each press of the button on GPIO 33 switches
// between the picture and the test card.

#include <stdio.h>
#include "board.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "media.h"
#include "network.h"
#include "nvs_flash.h"
#include "screen.h"
#include "test_card.h"
#include "web.h"

static const char *TAG = "esper";

#define POLL_MS 20 // how often the button and new pictures are checked

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

typedef enum { WAKE_TIMEOUT, WAKE_BUTTON, WAKE_NEW_PICTURE } wake_t;

// Waits up to `ms`, returning early on a button press or a new picture.
static wake_t wait(uint32_t ms)
{
    TickType_t start = xTaskGetTickCount();
    do {
        if (button_was_pressed()) {
            return WAKE_BUTTON;
        }
        if (media_has_changed()) {
            return WAKE_NEW_PICTURE;
        }
        vTaskDelay(pdMS_TO_TICKS(POLL_MS) ?: 1);
    } while (pdTICKS_TO_MS(xTaskGetTickCount() - start) < ms);
    return WAKE_TIMEOUT;
}

// Draws the stored picture, or the test card if there isn't a usable one.
// Returns true when a picture is showing; `hold_ms` gets how long to wait
// before the next animation frame (0 for a still picture). Call with the media
// lock held.
static bool show_stored(uint32_t *hold_ms)
{
    *hold_ms = 0;
    esp_err_t err = media_load();
    if (err == ESP_OK && media_show(hold_ms) == ESP_OK) {
        return true;
    }
    if (err == ESP_ERR_NOT_FOUND) {
        ESP_LOGI(TAG, "no picture yet: showing the test card");
    } else {
        ESP_LOGW(TAG, "stored picture not usable (%s): showing the test card", esp_err_to_name(err));
    }
    test_card_draw();
    return false;
}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_ERROR_CHECK(screen_init());
    button_init();
    ESP_ERROR_CHECK(media_init());
    ESP_LOGI(TAG, "%s %s on a %dx%d screen", ESPER_FIRMWARE_NAME, ESPER_FIRMWARE_VERSION,
             BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT);

    uint32_t hold;
    media_lock();
    bool picture = show_stored(&hold);
    media_unlock();
    screen_backlight(true);

    ESP_ERROR_CHECK(network_start());
    ESP_ERROR_CHECK(web_start());

    bool showing_card = false;
    while (true) {
        // `hold` is how long the frame on the screen stays; 0 means "until
        // something happens" (a still picture or the test card).
        if (wait(hold ? hold : POLL_MS) == WAKE_BUTTON) {
            showing_card = !showing_card;
            media_lock();
            if (showing_card || !picture) {
                test_card_draw();
                hold = 0;
            } else {
                picture = show_stored(&hold);
            }
            media_unlock();
            continue;
        }

        media_lock();
        if (media_take_changed()) {
            // A new picture arrived over Wi-Fi (or a transfer stopped part way).
            showing_card = false;
            picture = show_stored(&hold);
        } else if (hold && picture && !showing_card) {
            if (media_next_frame(&hold) != ESP_OK) {
                picture = false;
                hold = 0;
                test_card_draw();
            }
        }
        media_unlock();
    }
}
