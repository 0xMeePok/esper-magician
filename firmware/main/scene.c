#include "scene.h"

#include <stdlib.h>
#include <string.h>
#include "board.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "gif_decoder.h"
#include "scene_format.h"
#include "screen.h"

static const char *TAG = "scene";

#define W BOARD_LCD_WIDTH
#define H BOARD_LCD_HEIGHT
// Pixels put together before they go to the screen.
#define BAND_PIXELS (W * 24)
// A moving background is kept in memory in strips of this many rows, so no
// single block of memory has to hold the whole screen.
#define STRIP_ROWS 32
#define STRIPS ((H + STRIP_ROWS - 1) / STRIP_ROWS)
#define MAX_DIRTY (SCENE_MAX_SPRITES + 1)

static scene_t s_scene;
static const uint8_t *s_payload; // the payload, mapped from flash
static esp_partition_mmap_handle_t s_map;
static bool s_open;

static int64_t s_start_us;       // when the scene started, for its clock
static uint64_t s_state[SCENE_MAX_SPRITES];
static scene_rect_t s_area[SCENE_MAX_SPRITES];

// The background in memory: what a GIF draws onto, or a copy of a picture
// (much quicker to read than flash). A picture is read from flash when there
// isn't room.
static gif_t *s_gif;
static uint16_t *s_canvas[STRIPS];
static bool s_has_canvas;
static int s_gif_x, s_gif_y;     // where the GIF's top-left corner sits
static uint32_t s_gif_due;       // scene time of its next frame
static scene_rect_t s_gif_dirty; // the rows and columns its last frame drew

static uint16_t s_band[BAND_PIXELS];

static uint32_t now_ms(void)
{
    return (uint32_t)((esp_timer_get_time() - s_start_us) / 1000);
}

static bool read_gif(void *ctx, uint32_t offset, uint8_t *buf, uint32_t len)
{
    if (offset > s_scene.bg_length || len > s_scene.bg_length - offset) {
        return false;
    }
    memcpy(buf, s_payload + s_scene.bg_offset + offset, len);
    return true;
}

static uint16_t *canvas_row(int y)
{
    return s_canvas[y / STRIP_ROWS] + (size_t)(y % STRIP_ROWS) * W;
}

static void free_canvas(void)
{
    for (int i = 0; i < STRIPS; i++) {
        free(s_canvas[i]);
        s_canvas[i] = NULL;
    }
    s_has_canvas = false;
    free(s_gif);
    s_gif = NULL;
}

// A picture background is copied into memory only when this much would still
// be left (the screen joins Wi-Fi after it opens the design; that takes about
// 70 KB of what's left here, and the web server needs some too).
#define KEEP_FREE (48 * 1024)

static bool alloc_canvas(bool must)
{
    if (!must && heap_caps_get_free_size(MALLOC_CAP_8BIT) < (size_t)W * H * 2 + KEEP_FREE) {
        return false;
    }
    for (int i = 0; i < STRIPS; i++) {
        s_canvas[i] = heap_caps_malloc(STRIP_ROWS * W * 2, MALLOC_CAP_8BIT);
        if (!s_canvas[i]) {
            free_canvas();
            return false;
        }
    }
    s_has_canvas = true;
    return true;
}

static void grow(scene_rect_t *r, int x, int y, int w, int h)
{
    if (r->w == 0 || r->h == 0) {
        *r = (scene_rect_t){x, y, w, h};
        return;
    }
    int x1 = r->x + r->w > x + w ? r->x + r->w : x + w;
    int y1 = r->y + r->h > y + h ? r->y + r->h : y + h;
    r->x = r->x < x ? r->x : x;
    r->y = r->y < y ? r->y : y;
    r->w = x1 - r->x;
    r->h = y1 - r->y;
}

static void gif_row(void *ctx, int x, int y, int w, const uint16_t *px)
{
    x += s_gif_x;
    y += s_gif_y;
    if (y < 0 || y >= H) {
        return;
    }
    if (x < 0) {
        px -= x;
        w += x;
        x = 0;
    }
    if (x + w > W) {
        w = W - x;
    }
    if (w <= 0) {
        return;
    }
    memcpy(canvas_row(y) + x, px, (size_t)w * 2);
    grow(&s_gif_dirty, x, y, w, 1);
}

// Draws the GIF's next frame onto the canvas. Returns its delay.
static uint32_t gif_step(void)
{
    gif_frame_t frame;
    s_gif_dirty = (scene_rect_t){0};
    if (gif_next_frame(s_gif, &frame, gif_row, NULL) != GIF_OK) {
        ESP_LOGW(TAG, "background GIF frame failed: showing its colour instead");
        free_canvas();
        s_scene.bg = SCENE_BG_COLOR;
        s_gif_dirty = (scene_rect_t){0, 0, W, H};
        return 0;
    }
    return frame.delay_ms;
}

esp_err_t scene_open(const esp_partition_t *part, uint32_t offset, uint32_t length)
{
    scene_close();
    const void *ptr = NULL;
    ESP_RETURN_ON_ERROR(esp_partition_mmap(part, offset, length, ESP_PARTITION_MMAP_DATA, &ptr, &s_map),
                        TAG, "can't map the scene into memory");
    s_payload = ptr;
    s_open = true;
    int err = scene_parse(s_payload, length, W, H, &s_scene);
    if (err) {
        ESP_LOGW(TAG, "%s", err == -2 ? "made by a newer website; update the firmware over USB"
                                       : "the design is damaged");
        scene_close();
        return err == -2 ? ESP_ERR_NOT_SUPPORTED : ESP_ERR_INVALID_STATE;
    }

    if (s_scene.bg == SCENE_BG_PICTURE && alloc_canvas(false)) {
        for (int y = 0; y < H; y++) {
            memcpy(canvas_row(y), s_payload + s_scene.bg_offset + (size_t)y * W * 2, W * 2);
        }
    }
    if (s_scene.bg == SCENE_BG_GIF) {
        s_gif = malloc(sizeof(gif_t));
        bool ok = s_gif != NULL && alloc_canvas(true);
        if (ok && gif_open(s_gif, read_gif, NULL, s_scene.bg_length) != GIF_OK) {
            ESP_LOGW(TAG, "background GIF won't open: showing its colour instead");
            ok = false;
        } else if (!ok) {
            ESP_LOGW(TAG, "not enough memory for a moving background (%u bytes free): showing its colour",
                     (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT));
        }
        if (!ok) {
            free_canvas();
            s_scene.bg = SCENE_BG_COLOR;
        } else {
            s_gif_x = (W - s_gif->width) / 2;
            s_gif_y = (H - s_gif->height) / 2;
        }
    }
    static const char *const bg_names[] = {"a colour", "a picture", "a GIF"};
    ESP_LOGI(TAG, "design: %d parts over %s, %lu bytes; %u bytes of memory free", s_scene.count,
             bg_names[s_scene.bg], (unsigned long)length, (unsigned)heap_caps_get_free_size(MALLOC_CAP_8BIT));
    return ESP_OK;
}

int scene_brightness(void)
{
    return s_payload ? s_scene.brightness : 100;
}

void scene_close(void)
{
    free_canvas();
    if (s_open) {
        esp_partition_munmap(s_map);
        s_open = false;
    }
    s_payload = NULL;
}

// Fills `out` with the background of the w x n rectangle at (x, y).
static void background(int x, int y, int w, int n, uint16_t *out)
{
    for (int r = 0; r < n; r++, out += w) {
        if (s_has_canvas) {
            memcpy(out, canvas_row(y + r) + x, (size_t)w * 2);
            continue;
        }
        switch (s_scene.bg) {
        case SCENE_BG_PICTURE:
            memcpy(out, s_payload + s_scene.bg_offset + ((size_t)(y + r) * W + x) * 2, (size_t)w * 2);
            break;
        default:
            for (int i = 0; i < w; i++) {
                out[i] = s_scene.bg_color;
            }
        }
    }
}

static void compose(scene_rect_t r, uint32_t t)
{
    if (r.w <= 0 || r.h <= 0) {
        return;
    }
    int rows = BAND_PIXELS / r.w;
    for (int y = r.y; y < r.y + r.h; y += rows) {
        int n = r.y + r.h - y < rows ? r.y + r.h - y : rows;
        background(r.x, y, r.w, n, s_band);
        scene_draw_sprites(&s_scene, s_payload, t, r.x, y, r.w, n, s_band);
        // Goes out to the screen while the next band is worked out.
        screen_draw_queued(r.x, y, r.w, n, s_band);
    }
}

static bool overlap(scene_rect_t a, scene_rect_t b)
{
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

static uint32_t next_delay(uint32_t t)
{
    uint32_t next = scene_next_change(&s_scene, t);
    if (s_scene.bg == SCENE_BG_GIF && s_gif_due < next) {
        next = s_gif_due;
    }
    if (next == UINT32_MAX) {
        return 0; // nothing moves
    }
    return next > t ? next - t : 1;
}

esp_err_t scene_show(uint32_t *delay_ms)
{
    *delay_ms = 0;
    ESP_RETURN_ON_FALSE(s_payload, ESP_ERR_INVALID_STATE, TAG, "no scene open");
    if (s_scene.bg == SCENE_BG_GIF) {
        for (int y = 0; y < H; y++) {
            uint16_t *row = canvas_row(y);
            for (int x = 0; x < W; x++) {
                row[x] = s_scene.bg_color;
            }
        }
        // Start the animation again from its first frame.
        if (gif_open(s_gif, read_gif, NULL, s_scene.bg_length) != GIF_OK) {
            free_canvas();
            s_scene.bg = SCENE_BG_COLOR;
        }
    }
    s_start_us = esp_timer_get_time();
    if (s_scene.bg == SCENE_BG_GIF) {
        s_gif_due = gif_step();
    }
    for (int i = 0; i < s_scene.count; i++) {
        s_state[i] = scene_sprite_state(&s_scene.sprites[i], 0);
        s_area[i] = scene_sprite_area(&s_scene.sprites[i], 0);
    }
    compose((scene_rect_t){0, 0, W, H}, 0);
    screen_wait();
    // The website reads this line to tick "sent to the screen".
    ESP_LOGI(TAG, "drew design %dx%d with %d parts", W, H, s_scene.count);
    *delay_ms = next_delay(now_ms());
    return ESP_OK;
}

esp_err_t scene_next(uint32_t *delay_ms)
{
    *delay_ms = 0;
    ESP_RETURN_ON_FALSE(s_payload, ESP_ERR_INVALID_STATE, TAG, "no scene open");
    uint32_t t = now_ms();
    scene_rect_t dirty[MAX_DIRTY];
    int n = 0;

    if (s_scene.bg == SCENE_BG_GIF && t >= s_gif_due) {
        uint32_t delay = gif_step();
        // Running late: the next frame is due a full delay from now.
        s_gif_due = s_gif_due + delay > t ? s_gif_due + delay : t + delay;
        if (s_gif_dirty.w > 0) {
            dirty[n++] = s_gif_dirty;
        }
    }
    for (int i = 0; i < s_scene.count; i++) {
        const scene_sprite_t *s = &s_scene.sprites[i];
        uint64_t state = scene_sprite_state(s, t);
        if (state == s_state[i]) {
            continue;
        }
        scene_rect_t area = scene_sprite_area(s, t);
        scene_rect_t both = s_area[i];
        if (area.w > 0) {
            grow(&both, area.x, area.y, area.w, area.h);
        }
        s_state[i] = state;
        s_area[i] = area;
        if (both.w > 0 && both.h > 0 && n < MAX_DIRTY) {
            dirty[n++] = both;
        }
    }
    // Overlapping rectangles are drawn as one when that covers no more pixels
    // than drawing both (drawing a spot twice is harmless, just slower).
    for (int i = 0; i < n; i++) {
        for (int j = i + 1; j < n; j++) {
            scene_rect_t both = dirty[i];
            grow(&both, dirty[j].x, dirty[j].y, dirty[j].w, dirty[j].h);
            if (overlap(dirty[i], dirty[j]) &&
                both.w * both.h <= dirty[i].w * dirty[i].h + dirty[j].w * dirty[j].h) {
                dirty[i] = both;
                dirty[j] = dirty[--n];
                j = i; // it grew: check the others again
            }
        }
    }
    for (int i = 0; i < n; i++) {
        compose(dirty[i], t);
    }
    screen_wait();
    *delay_ms = next_delay(t);
    return ESP_OK;
}
