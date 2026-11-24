// The ST7789 screen: set-up and simple drawing. Every call blocks until the
// pixels are on the glass, and must come from one task at a time.
#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#define SCREEN_BACKGROUND 0x2945 // #2A2A2A, the colour round a picture that doesn't fill the screen

// Starts the SPI bus and the screen, with the backlight off.
esp_err_t screen_init(void);

// Turns the backlight on or off.
void screen_backlight(bool on);

// Fills a rectangle with one RGB565 colour.
esp_err_t screen_fill_rect(int x, int y, int w, int h, uint16_t rgb565);

// Fills the whole screen with one RGB565 colour.
esp_err_t screen_fill(uint16_t rgb565);

// Draws w*h pixels of host-order RGB565, row by row, at (x, y). Pixels off
// the screen are clipped.
esp_err_t screen_draw(int x, int y, int w, int h, const uint16_t *rgb565);
