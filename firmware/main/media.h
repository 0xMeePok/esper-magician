// The picture or GIF in the "media" partition: checking it, drawing it, and
// replacing it with one sent over Wi-Fi.
//
// Drawing and writing both use the screen and the partition, so callers hold
// media_lock() around them.
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

// Finds the partition. Call once at start-up.
esp_err_t media_init(void);

void media_lock(void);
void media_unlock(void);

// Reads and checks what's stored. ESP_OK when there is a picture to show;
// ESP_ERR_NOT_FOUND when nothing has been sent yet; another error when it is
// damaged or made for a different screen.
esp_err_t media_load(void);

// True when the loaded picture is an animation.
bool media_is_animated(void);

// Draws the loaded picture, or the first frame of an animation, centred on
// the background colour. For an animation, `delay_ms` gets how long to show
// the first frame; for a still picture it is 0.
esp_err_t media_show(uint32_t *delay_ms);

// Draws the next animation frame and says how long to show it.
esp_err_t media_next_frame(uint32_t *delay_ms);

// Size of the partition, header included.
uint32_t media_capacity(void);

// Replacing the stored picture. The header is written last, so a transfer
// that stops half way leaves "nothing sent" rather than a damaged picture.
esp_err_t media_write_begin(uint32_t total);
esp_err_t media_write(const uint8_t *data, uint32_t len);
// Writes the header and checks the result with media_load().
esp_err_t media_write_end(void);

// Set after a new picture has been written; cleared when read.
bool media_take_changed(void);
// The same, without clearing it.
bool media_has_changed(void);
