// A small streaming GIF decoder for the player. Plain C with no ESP-IDF
// headers, so it can be tested on a computer (firmware/test/).
//
// It reads through a callback (the media partition on the device, a file in
// the tests), decodes one frame at a time, and hands each row to another
// callback as RGB565. No full-frame buffer is needed: rows go straight to the
// screen. Transparent pixels are skipped, so they keep what is underneath.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#define GIF_MAX_WIDTH 320

enum {
    GIF_OK = 0,
    GIF_ERR_FORMAT = -1,      // not a GIF, or damaged
    GIF_ERR_READ = -2,        // the read callback failed
    GIF_ERR_TOO_WIDE = -3,    // a frame is wider than GIF_MAX_WIDTH
    GIF_ERR_NO_FRAMES = -4,
};

// Reads `len` bytes at `offset`. Returns false on failure.
typedef bool (*gif_read_fn)(void *ctx, uint32_t offset, uint8_t *buf, uint32_t len);

// One run of opaque pixels: `w` pixels starting at (x, y) in the GIF's own
// coordinates, as host-order RGB565.
typedef void (*gif_row_fn)(void *ctx, int x, int y, int w, const uint16_t *rgb565);

typedef struct {
    uint16_t x, y, w, h;   // where the frame sits inside the GIF
    uint16_t delay_ms;     // how long to show it (short delays become 100 ms, like browsers)
    bool looped;           // true for the first frame of the second and later loops
} gif_frame_t;

typedef struct {
    // Source
    gif_read_fn read;
    void *read_ctx;
    uint32_t size;
    uint32_t pos;
    uint8_t buf[256];
    uint32_t buf_start;
    uint32_t buf_len;

    // Logical screen
    uint16_t width, height;
    uint16_t global_colors[256];
    bool has_global;
    uint32_t first_block;   // offset of the first block after the header
    uint32_t frames_seen;   // frames decoded since the start of this loop
    bool any_frame;

    // Graphic control for the next frame
    uint16_t next_delay_ms;
    int next_transparent;   // -1 when none

    // LZW and row work space
    uint16_t local_colors[256];
    uint16_t prefix[4096];
    uint8_t suffix[4096];
    uint8_t stack[4097];
    uint16_t row[GIF_MAX_WIDTH];
    uint8_t row_index[GIF_MAX_WIDTH];
    int block_left;         // bytes left in the current data sub-block
} gif_t;

// Reads the header. Returns GIF_OK or a GIF_ERR_ value.
int gif_open(gif_t *gif, gif_read_fn read, void *ctx, uint32_t size);

// Decodes the next frame, calling `row` for its pixels. After the last frame
// it starts again from the first. Returns GIF_OK or a GIF_ERR_ value.
int gif_next_frame(gif_t *gif, gif_frame_t *frame, gif_row_fn row, void *row_ctx);

// Packs 8-bit RGB into host-order RGB565.
static inline uint16_t gif_rgb565(uint8_t r, uint8_t g, uint8_t b)
{
    return (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
}
