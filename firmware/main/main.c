// ESPER player for the 1.9-inch ST7789 screen on an ESP32 DevKit.
//
// Shows the picture or GIF in the "media" partition. The website writes it
// over USB the first time, then over Wi-Fi: it hands the picture to a small
// page this player serves on the home network (web.c).
//
// Before anything has been sent, or if what's stored is damaged, the screen
// shows a colour test card. Each press of the button (GPIO 33, or 16 on the
// 30-pin board) switches between the picture and the test card.

#include <stdio.h>
#include "board.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "logbuf.h"
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

// Waits until `due` (a tick count), returning early on a button press or a new
// picture. Never sleeps past `due`, so animation frames start on time.
static wake_t wait_until(TickType_t due)
{
    for (;;) {
        if (button_was_pressed()) {
            return WAKE_BUTTON;
        }
        if (media_has_changed()) {
            return WAKE_NEW_PICTURE;
        }
        TickType_t left = due - xTaskGetTickCount();
        if (left == 0 || left > portMAX_DELAY / 2) { // reached, or already past
            return WAKE_TIMEOUT;
        }
        TickType_t step = pdMS_TO_TICKS(POLL_MS) ?: 1;
        vTaskDelay(left < step ? left : step);
    }
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
    logbuf_start(); // so the website can read the log over Wi-Fi (GET /log)

    // NVS only holds the Wi-Fi details. If it can't be read (full, a newer
    // format, or left over from another flash layout), start it fresh: the
    // setup hotspot then asks for the Wi-Fi again.
    esp_err_t err = nvs_flash_init();
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "settings storage unreadable (%s): starting it fresh", esp_err_to_name(err));
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    ESP_ERROR_CHECK(screen_init());
    button_init();
    ESP_ERROR_CHECK(media_init());
    ESP_LOGI(TAG, "%s %s on a %dx%d screen", ESPER_FIRMWARE_NAME, ESPER_FIRMWARE_VERSION,
             BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT);
    // The website reads this line to check the build matches the board picked there.
    ESP_LOGI(TAG, "board %s: %s, BLK GPIO %d, button GPIO %d", BOARD_ID, BOARD_NAME,
             BOARD_LCD_PIN_BL, BOARD_PIN_BUTTON);

    uint32_t hold;
    media_lock();
    bool picture = show_stored(&hold);
    media_unlock();
    screen_backlight(true);
    ESP_LOGI(TAG, "backlight on: showing %s", picture ? "the picture" : "the test card");

    ESP_ERROR_CHECK(network_start());
    ESP_ERROR_CHECK(web_start());

    // Got this far, so this version works: keep it. With rollback on, a new
    // version that crashes before here goes back to the one before.
    esp_ota_mark_app_valid_cancel_rollback();
    const esp_partition_t *running = esp_ota_get_running_partition();
    const esp_partition_t *spare = esp_ota_get_next_update_partition(NULL);
    ESP_LOGI(TAG, "running from %s; %s is free for the next version", running ? running->label : "?",
             spare ? spare->label : "no slot");

    // When the frame now on the screen started drawing. The next frame is due
    // `hold` ms after that, so the time spent decoding and drawing comes out of
    // the frame's delay instead of being added to it.
    TickType_t drawn_at = xTaskGetTickCount();
    bool showing_card = false;
    while (true) {
        // `hold` is how long the frame on the screen stays; 0 means "until
        // something happens" (a still picture or the test card).
        TickType_t now = xTaskGetTickCount();
        TickType_t due = hold ? drawn_at + pdMS_TO_TICKS(hold) : now + (pdMS_TO_TICKS(POLL_MS) ?: 1);
        wake_t wake = wait_until(due);
        // Running late (a slow frame): start from now rather than rushing to catch up.
        now = xTaskGetTickCount();
        drawn_at = hold && now - due < pdMS_TO_TICKS(hold) ? due : now;
        if (wake == WAKE_BUTTON) {
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
