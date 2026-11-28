#include "scene_format.h"

#include <string.h>

static uint16_t le16(const uint8_t *p)
{
    return (uint16_t)(p[0] | (p[1] << 8));
}

static int16_t les16(const uint8_t *p)
{
    return (int16_t)le16(p);
}

static uint32_t le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int max_i(int a, int b)
{
    return a > b ? a : b;
}

static int min_i(int a, int b)
{
    return a < b ? a : b;
}

// Rounds down, for negative numbers too.
static int floor_div(int a, int b)
{
    int q = a / b;
    return (a % b != 0 && (a < 0) != (b < 0)) ? q - 1 : q;
}

int scene_parse(const uint8_t *b, uint32_t len, int width, int height, scene_t *out)
{
    if (len < SCENE_HEADER_BYTES || memcmp(b, "SCNE", 4) != 0) {
        return -1;
    }
    if (le16(b + 4) != SCENE_VERSION) {
        return -2;
    }
    int count = le16(b + 6);
    if (count > SCENE_MAX_SPRITES || len < SCENE_HEADER_BYTES + (uint32_t)count * SCENE_SPRITE_BYTES) {
        return -1;
    }
    out->bg = (scene_bg_t)le16(b + 8);
    out->brightness = b[20] >= 1 && b[20] <= 100 ? b[20] : 100;
    out->bg_color = le16(b + 10);
    out->bg_offset = le32(b + 12);
    out->bg_length = le32(b + 16);
    if (out->bg_offset > len || out->bg_length > len - out->bg_offset) {
        return -1;
    }
    switch (out->bg) {
    case SCENE_BG_COLOR:
        break;
    case SCENE_BG_PICTURE:
        if (out->bg_length != (uint32_t)width * height * 2) {
            return -1;
        }
        break;
    case SCENE_BG_GIF:
        if (out->bg_length == 0) {
            return -1;
        }
        break;
    default:
        return -1;
    }

    out->count = count;
    for (int i = 0; i < count; i++) {
        const uint8_t *p = b + SCENE_HEADER_BYTES + i * SCENE_SPRITE_BYTES;
        scene_sprite_t *s = &out->sprites[i];
        s->clip_x = les16(p);
        s->clip_y = les16(p + 2);
        s->clip_w = les16(p + 4);
        s->clip_h = les16(p + 6);
        s->x = les16(p + 8);
        s->y = les16(p + 10);
        s->w = le16(p + 12);
        s->h = le16(p + 14);
        s->dx = les16(p + 16);
        s->dy = les16(p + 18);
        s->step_ms = le16(p + 20);
        s->period = le16(p + 22);
        s->blink_on_ms = le16(p + 24);
        s->blink_off_ms = le16(p + 26);
        s->pixels = le32(p + 28);
        if (s->w == 0 || s->h == 0 || (s->dx && s->dy) || ((s->dx || s->dy) && s->step_ms == 0)) {
            return -1;
        }
        uint64_t bytes = (uint64_t)s->w * s->h * 3;
        if (s->pixels > len || bytes > len - s->pixels) {
            return -1;
        }
        // Keep the clip on the screen, so drawing never leaves it.
        int x0 = max_i(s->clip_x, 0), y0 = max_i(s->clip_y, 0);
        int x1 = min_i(s->clip_x + max_i(s->clip_w, 0), width);
        int y1 = min_i(s->clip_y + max_i(s->clip_h, 0), height);
        s->clip_x = (int16_t)x0;
        s->clip_y = (int16_t)y0;
        s->clip_w = (int16_t)max_i(x1 - x0, 0);
        s->clip_h = (int16_t)max_i(y1 - y0, 0);
    }
    return 0;
}

static bool moving(const scene_sprite_t *s)
{
    return (s->dx || s->dy) && s->step_ms;
}

static bool blinking(const scene_sprite_t *s)
{
    return s->blink_on_ms && s->blink_off_ms;
}

static uint32_t steps_at(const scene_sprite_t *s, uint32_t t_ms)
{
    return moving(s) ? t_ms / s->step_ms : 0;
}

void scene_sprite_at(const scene_sprite_t *s, uint32_t t_ms, int *x, int *y)
{
    *x = s->x;
    *y = s->y;
    if (!moving(s)) {
        return;
    }
    uint64_t step = s->dx ? (s->dx < 0 ? -s->dx : s->dx) : (s->dy < 0 ? -s->dy : s->dy);
    uint64_t distance = (uint64_t)steps_at(s, t_ms) * step;
    // Without repeats it moves away for good; stop counting once it's far off.
    int off = s->period ? (int)(distance % s->period) : (int)(distance > 30000 ? 30000 : distance);
    if (s->dx) {
        *x += s->dx > 0 ? off : -off;
    } else {
        *y += s->dy > 0 ? off : -off;
    }
}

bool scene_sprite_visible(const scene_sprite_t *s, uint32_t t_ms)
{
    if (!blinking(s)) {
        return true;
    }
    return t_ms % ((uint32_t)s->blink_on_ms + s->blink_off_ms) < s->blink_on_ms;
}

uint32_t scene_next_change(const scene_t *scene, uint32_t t_ms)
{
    uint64_t next = UINT32_MAX;
    for (int i = 0; i < scene->count; i++) {
        const scene_sprite_t *s = &scene->sprites[i];
        if (moving(s)) {
            uint64_t at = ((uint64_t)t_ms / s->step_ms + 1) * s->step_ms;
            next = at < next ? at : next;
        }
        if (blinking(s)) {
            uint32_t cycle = (uint32_t)s->blink_on_ms + s->blink_off_ms;
            uint32_t phase = t_ms % cycle;
            uint64_t at = (uint64_t)t_ms - phase + (phase < s->blink_on_ms ? s->blink_on_ms : cycle);
            next = at < next ? at : next;
        }
    }
    return next > UINT32_MAX ? UINT32_MAX : (uint32_t)next;
}

// The copies of a sprite that reach into its clip: the first one's corner, how
// far apart they are, and how many.
typedef struct {
    int x, y, step_x, step_y, count;
} copies_t;

static copies_t copies_at(const scene_sprite_t *s, uint32_t t_ms)
{
    copies_t c = {0};
    scene_sprite_at(s, t_ms, &c.x, &c.y);
    c.count = 1;
    if (!moving(s) || !s->period) {
        return c;
    }
    int p = s->period;
    if (s->dx) {
        // Copies sit at x + k*p; the first one whose right edge is in the clip.
        int k = floor_div(s->clip_x - s->w - c.x, p) + 1;
        c.x += k * p;
        c.step_x = p;
        c.count = c.x < s->clip_x + s->clip_w ? (s->clip_x + s->clip_w - c.x + p - 1) / p : 0;
    } else {
        int k = floor_div(s->clip_y - s->h - c.y, p) + 1;
        c.y += k * p;
        c.step_y = p;
        c.count = c.y < s->clip_y + s->clip_h ? (s->clip_y + s->clip_h - c.y + p - 1) / p : 0;
    }
    return c;
}

scene_rect_t scene_sprite_area(const scene_sprite_t *s, uint32_t t_ms)
{
    scene_rect_t none = {0, 0, 0, 0};
    if (!scene_sprite_visible(s, t_ms) || s->clip_w <= 0 || s->clip_h <= 0) {
        return none;
    }
    copies_t c = copies_at(s, t_ms);
    if (c.count <= 0) {
        return none;
    }
    int last_x = c.x + c.step_x * (c.count - 1), last_y = c.y + c.step_y * (c.count - 1);
    int x0 = max_i(c.x, s->clip_x), y0 = max_i(c.y, s->clip_y);
    int x1 = min_i(last_x + s->w, s->clip_x + s->clip_w);
    int y1 = min_i(last_y + s->h, s->clip_y + s->clip_h);
    if (x1 <= x0 || y1 <= y0) {
        return none;
    }
    scene_rect_t r = {x0, y0, x1 - x0, y1 - y0};
    return r;
}

uint64_t scene_sprite_state(const scene_sprite_t *s, uint32_t t_ms)
{
    return ((uint64_t)steps_at(s, t_ms) << 1) | (scene_sprite_visible(s, t_ms) ? 1 : 0);
}

uint16_t scene_blend(uint16_t bg, uint16_t fg, uint8_t alpha)
{
    return scene_blend_inline(bg, fg, alpha);
}

static void draw_copy(const scene_sprite_t *s, const uint8_t *px, int cx, int cy, int x, int y,
                      int w, int h, uint16_t *out)
{
    int x0 = max_i(max_i(cx, s->clip_x), x), y0 = max_i(max_i(cy, s->clip_y), y);
    int x1 = min_i(min_i(cx + s->w, s->clip_x + s->clip_w), x + w);
    int y1 = min_i(min_i(cy + s->h, s->clip_y + s->clip_h), y + h);
    for (int row = y0; row < y1; row++) {
        const uint8_t *src = px + ((size_t)(row - cy) * s->w + (size_t)(x0 - cx)) * 3;
        uint16_t *dst = out + (size_t)(row - y) * w + (x0 - x);
        for (int col = x0; col < x1; col++, src += 3, dst++) {
            uint8_t a = src[2];
            if (a == 0) {
                continue;
            }
            uint16_t color = (uint16_t)(src[0] | (src[1] << 8));
            *dst = a == 255 ? color : scene_blend_inline(*dst, color, a);
        }
    }
}

void scene_draw_sprites(const scene_t *scene, const uint8_t *payload, uint32_t t_ms, int x, int y,
                        int w, int h, uint16_t *out)
{
    for (int i = 0; i < scene->count; i++) {
        const scene_sprite_t *s = &scene->sprites[i];
        if (!scene_sprite_visible(s, t_ms)) {
            continue;
        }
        copies_t c = copies_at(s, t_ms);
        for (int k = 0; k < c.count; k++) {
            draw_copy(s, payload + s->pixels, c.x + k * c.step_x, c.y + k * c.step_y, x, y, w, h, out);
        }
    }
}
