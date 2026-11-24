// Plays a picture or animation made by tools/img2cyd.py.
//
// File layout (all header numbers little-endian):
//   char     magic[4]      "CYD1"
//   uint16_t width         pixels
//   uint16_t height        pixels
//   uint16_t frame_count   1 for a still picture
//   uint16_t reserved      0
//   uint16_t delay_ms[frame_count]
//   pixel data, frame after frame, RGB565 big-endian, row by row
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"

typedef struct {
    uint16_t width;
    uint16_t height;
    uint16_t frame_count;
    const uint8_t *delays;       // raw delay table, read with cyd_picture_delay_ms()
    const uint8_t *pixels;       // first frame
} cyd_picture_t;

// Checks the header and fills `out`. Returns ESP_ERR_INVALID_ARG if the data
// is not a valid file.
esp_err_t cyd_picture_parse(const uint8_t *data, size_t len, cyd_picture_t *out);

// Delay after frame `index`, in milliseconds.
uint16_t cyd_picture_delay_ms(const cyd_picture_t *pic, uint16_t index);

// Sends one frame to the screen, centred. Blocks until it is on the glass.
esp_err_t cyd_picture_draw_frame(esp_lcd_panel_handle_t panel,
                                 const cyd_picture_t *pic, uint16_t index);

// Call once before drawing. Sets up the DMA buffers and the signal used to
// wait for each transfer to finish.
esp_err_t cyd_picture_player_init(void);

// Hook this into esp_lcd_panel_io_spi_config_t.on_color_trans_done.
bool cyd_picture_on_trans_done(esp_lcd_panel_io_handle_t io,
                               esp_lcd_panel_io_event_data_t *edata,
                               void *user_ctx);

// Fills a rectangle with one RGB565 colour.
esp_err_t cyd_fill_rect(esp_lcd_panel_handle_t panel, int x, int y, int w, int h,
                        uint16_t rgb565);

// Fills the whole screen with one RGB565 colour.
esp_err_t cyd_fill_screen(esp_lcd_panel_handle_t panel, uint16_t rgb565);
