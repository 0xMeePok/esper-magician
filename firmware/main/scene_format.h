// A text design from the website's Text page (media kind 3, a "scene"): a
// background and up to SCENE_MAX_SPRITES pictures with see-through edges
// ("sprites": lines of text, LED dots, stickers) that the player moves and
// blinks itself. Moving a small picture is far smoother, and far smaller, than
// a GIF of every step.
//
// Plain C with no ESP-IDF headers, so the tests can use it on a computer.
// Keep in step with src/text/sceneFormat.ts.
//
// The payload (after the 4 KB media header), all numbers little-endian:
//   0x00  char  magic[4]       "SCNE"
//   0x04  u16   version        1
//   0x06  u16   sprite_count   at most SCENE_MAX_SPRITES
//   0x08  u16   background     0 = one colour, 1 = RGB565 picture, 2 = GIF
//   0x0A  u16   colour         RGB565: the background, and round a GIF
//   0x0C  u32   offset         where the picture or GIF starts in the payload;
//   0x10  u32   length         a picture is screen width * height * 2 bytes,
//                              row by row
//   0x14  u8    brightness     the screen's backlight while this shows, in
//                              percent; 0 (or over 100) means full
//   0x15  3 bytes reserved     0
//   0x18  sprites, SCENE_SPRITE_BYTES each, drawn in order (the last on top):
//     +0   i16 clip x, y, w, h   the sprite only shows inside this rectangle
//     +8   i16 x, y              its top-left corner at the start
//     +12  u16 w, h              its size
//     +16  i16 dx, dy            pixels it moves per step, along one axis
//     +20  u16 step_ms           time between steps
//     +22  u16 period            distance between copies along the move: it
//                                repeats forever; 0 means one copy
//     +24  u16 blink_on_ms       shown for this long, then hidden for
//     +26  u16 blink_off_ms      this long; 0 and 0 means always shown
//     +28  u32 pixels            where its w*h pixels start: u16 RGB565, then
//                                u8 alpha (0 see-through .. 255 solid)
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SCENE_HEADER_BYTES 24
#define SCENE_SPRITE_BYTES 32
#define SCENE_MAX_SPRITES 32
#define SCENE_VERSION 1

typedef enum {
    SCENE_BG_COLOR = 0,
    SCENE_BG_PICTURE = 1,
    SCENE_BG_GIF = 2,
} scene_bg_t;

typedef struct {
    int16_t clip_x, clip_y, clip_w, clip_h;
    int16_t x, y;
    uint16_t w, h;
    int16_t dx, dy;
    uint16_t step_ms;
    uint16_t period;
    uint16_t blink_on_ms, blink_off_ms;
    uint32_t pixels;
} scene_sprite_t;

typedef struct {
    scene_bg_t bg;
    uint8_t brightness; // 1..100 percent
    uint16_t bg_color;
    uint32_t bg_offset, bg_length;
    int count;
    scene_sprite_t sprites[SCENE_MAX_SPRITES];
} scene_t;

typedef struct {
    int x, y, w, h;
} scene_rect_t;

// Reads and checks a scene for a screen of `width` x `height`. Every offset and
// size is checked against `len`, so drawing never reads past the payload.
// Returns 0, or a negative number saying what is wrong.
int scene_parse(const uint8_t *payload, uint32_t len, int width, int height, scene_t *out);

// Where a sprite's first copy is at `t_ms` after the scene started (the
// others are `period` apart along the move).
void scene_sprite_at(const scene_sprite_t *s, uint32_t t_ms, int *x, int *y);

// Whether a sprite is shown at `t_ms` (blinking).
bool scene_sprite_visible(const scene_sprite_t *s, uint32_t t_ms);

// The time after `t_ms` when something next moves or blinks, or UINT32_MAX
// when nothing ever does.
uint32_t scene_next_change(const scene_t *scene, uint32_t t_ms);

// The part of the screen a sprite covers at `t_ms`: all its copies, inside its
// clip. w or h is 0 when nothing shows.
scene_rect_t scene_sprite_area(const scene_sprite_t *s, uint32_t t_ms);

// The sprite's state at `t_ms` that drawing depends on: changes exactly when
// it needs redrawing.
uint64_t scene_sprite_state(const scene_sprite_t *s, uint32_t t_ms);

// Draws every sprite shown at `t_ms` over the pixels in `out`: the w*h
// rectangle at (x, y), host-order RGB565 row by row, already holding the
// background.
void scene_draw_sprites(const scene_t *scene, const uint8_t *payload, uint32_t t_ms, int x, int y,
                        int w, int h, uint16_t *out);

// Mixes `fg` over `bg` with `alpha` 0..255, as the player does.
uint16_t scene_blend(uint16_t bg, uint16_t fg, uint8_t alpha);

static inline uint16_t scene_blend_inline(uint16_t bg, uint16_t fg, uint8_t alpha)
{
    // Red, green and blue spread out in one 32-bit word, so one multiply
    // mixes all three. 33 steps of see-through (0..32), like the screen's
    // 5-bit red; alpha * 33 / 256 needs no division.
    uint32_t a = ((uint32_t)alpha * 33) >> 8;
    uint32_t b = (bg | ((uint32_t)bg << 16)) & 0x07E0F81Fu;
    uint32_t f = (fg | ((uint32_t)fg << 16)) & 0x07E0F81Fu;
    uint32_t mix = ((f * a + b * (32 - a)) >> 5) & 0x07E0F81Fu;
    return (uint16_t)(mix | (mix >> 16));
}
