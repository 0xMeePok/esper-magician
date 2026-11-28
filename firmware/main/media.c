#include "media.h"

#include <stdlib.h>
#include <string.h>
#include "board.h"
#include "esp32/rom/tjpgd.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "gif_decoder.h"
#include "media_format.h"
#include "scene.h"
#include "screen.h"

static const char *TAG = "media";

#define MEDIA_SUBTYPE 0x40
#define ERASE_BLOCK (64 * 1024)
#define BAND_ROWS 16
#define MAX_ITEMS 32 // most pictures looked for in a playlist

static const esp_partition_t *s_part;
static SemaphoreHandle_t s_lock;
static media_header_t s_header;
static uint32_t s_base; // where the loaded picture's header starts in the partition
static bool s_loaded;
static volatile bool s_changed;

static gif_t *s_gif;     // allocated while an animation is loaded
static int s_ox, s_oy;   // where the picture's top-left corner sits on the screen

// Rows collected before they go to the screen together.
static struct {
    int x, y, w, rows;
    uint16_t px[BOARD_LCD_WIDTH * BAND_ROWS];
} s_band;

// Writing
static uint8_t *s_head;  // the first 4 KB, written last
static uint32_t s_total, s_written, s_erased;

esp_err_t media_init(void)
{
    s_lock = xSemaphoreCreateMutex();
    ESP_RETURN_ON_FALSE(s_lock, ESP_ERR_NO_MEM, TAG, "no mutex");
    s_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, MEDIA_SUBTYPE, "media");
    ESP_RETURN_ON_FALSE(s_part, ESP_ERR_NOT_FOUND, TAG, "no media partition");
    ESP_LOGI(TAG, "media partition: %lu KB at 0x%lx", (unsigned long)(s_part->size / 1024),
             (unsigned long)s_part->address);
    return ESP_OK;
}

void media_lock(void)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
}

void media_unlock(void)
{
    xSemaphoreGive(s_lock);
}

uint32_t media_capacity(void)
{
    return s_part ? s_part->size : 0;
}

bool media_take_changed(void)
{
    bool changed = s_changed;
    s_changed = false;
    return changed;
}

bool media_has_changed(void)
{
    return s_changed;
}

int media_brightness(void)
{
    return s_loaded && s_header.kind == MEDIA_KIND_SCENE ? scene_brightness() : 100;
}

bool media_is_animated(void)
{
    return s_loaded && (s_header.kind == MEDIA_KIND_GIF || s_header.kind == MEDIA_KIND_SCENE);
}

static bool read_payload(void *ctx, uint32_t offset, uint8_t *buf, uint32_t len)
{
    return esp_partition_read(s_part, s_base + MEDIA_HEADER_BYTES + offset, buf, len) == ESP_OK;
}

// Finds where the `index`-th picture's header starts. Returns false when there
// are fewer valid pictures: the walk stops at the first header that isn't one.
static bool find_item(int index, uint32_t *at_out)
{
    uint32_t at = 0;
    for (int i = 0; i < MAX_ITEMS && at + MEDIA_HEADER_BYTES <= s_part->size; i++) {
        uint8_t head[32];
        media_header_t h;
        if (esp_partition_read(s_part, at, head, sizeof(head)) != ESP_OK ||
            media_header_parse(head, sizeof(head), s_part->size - at, &h) != MEDIA_HEADER_OK) {
            return false;
        }
        if (i == index) {
            *at_out = at;
            return true;
        }
        at = media_next_offset(head, sizeof(head), &h, at);
        if (at == 0) {
            return false;
        }
    }
    return false;
}

int media_count(void)
{
    int n = 0;
    uint32_t at;
    while (s_part && n < MAX_ITEMS && find_item(n, &at)) {
        n++;
    }
    return n;
}

esp_err_t media_load(void)
{
    return media_load_at(0);
}

esp_err_t media_load_at(int index)
{
    s_loaded = false;
    free(s_gif);
    s_gif = NULL;
    scene_close();
    ESP_RETURN_ON_FALSE(s_part, ESP_ERR_NOT_FOUND, TAG, "no media partition");
    // The first picture is always read from the start, so an empty or damaged
    // header is reported as such rather than as "no picture".
    s_base = 0;
    if (index > 0 && !find_item(index, &s_base)) {
        return ESP_ERR_NOT_FOUND;
    }

    uint8_t head[32];
    ESP_RETURN_ON_ERROR(esp_partition_read(s_part, s_base, head, sizeof(head)), TAG, "read");
    switch (media_header_parse(head, sizeof(head), s_part->size - s_base, &s_header)) {
    case MEDIA_HEADER_OK:
        break;
    case MEDIA_HEADER_EMPTY:
        return ESP_ERR_NOT_FOUND;
    case MEDIA_HEADER_VERSION:
        ESP_LOGW(TAG, "picture was made by a newer website; update the firmware over USB");
        return ESP_ERR_NOT_SUPPORTED;
    default:
        ESP_LOGW(TAG, "picture header is damaged");
        return ESP_ERR_INVALID_STATE;
    }
    if (s_header.screen_width != BOARD_LCD_WIDTH || s_header.screen_height != BOARD_LCD_HEIGHT) {
        ESP_LOGW(TAG, "picture is for a %ux%u screen", s_header.screen_width, s_header.screen_height);
        return ESP_ERR_INVALID_SIZE;
    }

    // Check every byte, so a damaged transfer never reaches the decoders.
    uint8_t *chunk = malloc(4096);
    ESP_RETURN_ON_FALSE(chunk, ESP_ERR_NO_MEM, TAG, "no memory");
    uint32_t crc = 0;
    for (uint32_t at = 0; at < s_header.length; at += 4096) {
        uint32_t n = s_header.length - at < 4096 ? s_header.length - at : 4096;
        if (!read_payload(NULL, at, chunk, n)) {
            free(chunk);
            return ESP_FAIL;
        }
        crc = media_crc32(crc, chunk, n);
    }
    free(chunk);
    if (crc != s_header.crc32) {
        ESP_LOGW(TAG, "picture is damaged (CRC 0x%08lx, expected 0x%08lx)", (unsigned long)crc,
                 (unsigned long)s_header.crc32);
        return ESP_ERR_INVALID_CRC;
    }

    if (s_header.kind == MEDIA_KIND_GIF) {
        s_gif = malloc(sizeof(gif_t));
        ESP_RETURN_ON_FALSE(s_gif, ESP_ERR_NO_MEM, TAG, "no memory for the GIF decoder");
        int err = gif_open(s_gif, read_payload, NULL, s_header.length);
        if (err != GIF_OK) {
            ESP_LOGW(TAG, "GIF won't open (%d)", err);
            free(s_gif);
            s_gif = NULL;
            return ESP_ERR_INVALID_STATE;
        }
        s_ox = (BOARD_LCD_WIDTH - s_gif->width) / 2;
        s_oy = (BOARD_LCD_HEIGHT - s_gif->height) / 2;
        ESP_LOGI(TAG, "GIF %dx%d at (%d,%d)", s_gif->width, s_gif->height, s_ox, s_oy);
    } else if (s_header.kind == MEDIA_KIND_SCENE) {
        ESP_RETURN_ON_ERROR(scene_open(s_part, s_base + MEDIA_HEADER_BYTES, s_header.length), TAG,
                            "design won't open");
    }
    s_loaded = true;
    // The website compares this CRC with the one it sent.
    static const char *const names[] = {"?", "JPEG", "GIF", "Text design"};
    ESP_LOGI(TAG, "%s, %lu bytes, CRC 0x%08lx OK", names[s_header.kind <= 3 ? s_header.kind : 0],
             (unsigned long)s_header.length, (unsigned long)s_header.crc32);
    return ESP_OK;
}

// ---- JPEG, decoded by the TJpgDec copy in the ESP32's ROM ----

typedef struct {
    uint32_t pos;
    uint16_t block[16 * 16]; // one MCU, the most the decoder hands over at once
} jpeg_ctx_t;

static UINT jpeg_input(JDEC *jd, BYTE *buf, UINT n)
{
    jpeg_ctx_t *ctx = jd->device;
    uint32_t left = s_header.length - ctx->pos;
    if (n > left) {
        n = left;
    }
    if (buf && n && !read_payload(NULL, ctx->pos, buf, n)) {
        return 0;
    }
    ctx->pos += n;
    return n;
}

static UINT jpeg_output(JDEC *jd, void *bitmap, JRECT *r)
{
    jpeg_ctx_t *ctx = jd->device;
    int w = r->right - r->left + 1, h = r->bottom - r->top + 1;
    if (w * h > (int)(sizeof(ctx->block) / 2)) {
        return 0;
    }
    const uint8_t *rgb = bitmap;
    for (int i = 0; i < w * h; i++, rgb += 3) {
        ctx->block[i] = gif_rgb565(rgb[0], rgb[1], rgb[2]);
    }
    return screen_draw(s_ox + r->left, s_oy + r->top, w, h, ctx->block) == ESP_OK;
}

static esp_err_t show_jpeg(void)
{
    jpeg_ctx_t *ctx = calloc(1, sizeof(jpeg_ctx_t));
    void *work = malloc(4096);
    esp_err_t err = ESP_ERR_NO_MEM;
    if (ctx && work) {
        JDEC jd;
        JRESULT res = jd_prepare(&jd, jpeg_input, work, 4096, ctx);
        if (res == JDR_OK) {
            s_ox = (BOARD_LCD_WIDTH - (int)jd.width) / 2;
            s_oy = (BOARD_LCD_HEIGHT - (int)jd.height) / 2;
            res = jd_decomp(&jd, jpeg_output, 0);
        }
        err = res == JDR_OK ? ESP_OK : ESP_ERR_INVALID_STATE;
        if (res != JDR_OK) {
            ESP_LOGW(TAG, "JPEG decode failed (%d)", res);
        } else {
            ESP_LOGI(TAG, "drew JPEG %ux%u at (%d,%d)", jd.width, jd.height, s_ox, s_oy);
        }
    }
    free(work);
    free(ctx);
    return err;
}

// ---- GIF ----

static void flush_band(void)
{
    if (s_band.rows) {
        screen_draw(s_band.x, s_band.y, s_band.w, s_band.rows, s_band.px);
        s_band.rows = 0;
    }
}

static void gif_row(void *ctx, int x, int y, int w, const uint16_t *px)
{
    x += s_ox;
    y += s_oy;
    if (s_band.rows && (x != s_band.x || w != s_band.w || y != s_band.y + s_band.rows ||
                        s_band.rows == BAND_ROWS)) {
        flush_band();
    }
    if (w > BOARD_LCD_WIDTH) {
        w = BOARD_LCD_WIDTH;
    }
    if (!s_band.rows) {
        s_band.x = x;
        s_band.y = y;
        s_band.w = w;
    }
    memcpy(s_band.px + s_band.rows * w, px, (size_t)w * 2);
    s_band.rows++;
}

esp_err_t media_next_frame(uint32_t *delay_ms)
{
    if (s_loaded && s_header.kind == MEDIA_KIND_SCENE) {
        return scene_next(delay_ms);
    }
    ESP_RETURN_ON_FALSE(s_gif, ESP_ERR_INVALID_STATE, TAG, "not an animation");
    gif_frame_t frame;
    s_band.rows = 0;
    int err = gif_next_frame(s_gif, &frame, gif_row, NULL);
    flush_band();
    if (err != GIF_OK) {
        ESP_LOGW(TAG, "GIF frame failed (%d)", err);
        return ESP_ERR_INVALID_STATE;
    }
    *delay_ms = frame.delay_ms;
    return ESP_OK;
}

esp_err_t media_show(uint32_t *delay_ms)
{
    *delay_ms = 0;
    ESP_RETURN_ON_FALSE(s_loaded, ESP_ERR_INVALID_STATE, TAG, "nothing loaded");
    if (s_header.kind == MEDIA_KIND_SCENE) {
        return scene_show(delay_ms); // it draws the whole screen itself
    }
    ESP_RETURN_ON_ERROR(screen_fill(SCREEN_BACKGROUND), TAG, "fill");
    if (s_header.kind == MEDIA_KIND_JPEG) {
        return show_jpeg();
    }
    // Start the animation again from its first frame.
    ESP_RETURN_ON_FALSE(gif_open(s_gif, read_payload, NULL, s_header.length) == GIF_OK,
                        ESP_ERR_INVALID_STATE, TAG, "GIF won't open");
    return media_next_frame(delay_ms);
}

// ---- Writing ----

static esp_err_t erase_up_to(uint32_t end)
{
    while (s_erased < end) {
        uint32_t n = ERASE_BLOCK - (s_erased % ERASE_BLOCK);
        if (s_erased + n > s_part->size) {
            n = s_part->size - s_erased;
        }
        ESP_RETURN_ON_ERROR(esp_partition_erase_range(s_part, s_erased, n), TAG, "erase");
        s_erased += n;
    }
    return ESP_OK;
}

esp_err_t media_write_begin(uint32_t total)
{
    ESP_RETURN_ON_FALSE(s_part, ESP_ERR_NOT_FOUND, TAG, "no media partition");
    ESP_RETURN_ON_FALSE(total > MEDIA_HEADER_BYTES && total <= s_part->size, ESP_ERR_INVALID_SIZE,
                        TAG, "%lu bytes won't fit", (unsigned long)total);
    free(s_gif);
    s_gif = NULL;
    scene_close(); // a design reads straight from the flash about to be rewritten
    s_loaded = false;
    s_base = 0;
    free(s_head);
    s_head = malloc(MEDIA_HEADER_BYTES);
    ESP_RETURN_ON_FALSE(s_head, ESP_ERR_NO_MEM, TAG, "no memory");
    s_total = total;
    s_written = 0;
    s_changed = true; // the main loop redraws when the write is over, whatever the outcome
    s_erased = 0;
    // The first block holds the old header: erase it now, so an interrupted
    // transfer reads as "nothing sent".
    return erase_up_to(MEDIA_HEADER_BYTES);
}

esp_err_t media_write(const uint8_t *data, uint32_t len)
{
    ESP_RETURN_ON_FALSE(s_head && s_written + len <= s_total, ESP_ERR_INVALID_SIZE, TAG,
                        "more data than announced");
    if (s_written < MEDIA_HEADER_BYTES) {
        uint32_t n = MEDIA_HEADER_BYTES - s_written;
        if (n > len) {
            n = len;
        }
        memcpy(s_head + s_written, data, n);
        s_written += n;
        data += n;
        len -= n;
    }
    if (len) {
        ESP_RETURN_ON_ERROR(erase_up_to(s_written + len), TAG, "erase");
        ESP_RETURN_ON_ERROR(esp_partition_write(s_part, s_written, data, len), TAG, "write");
        s_written += len;
    }
    return ESP_OK;
}

esp_err_t media_write_end(void)
{
    ESP_RETURN_ON_FALSE(s_head && s_written == s_total, ESP_ERR_INVALID_SIZE, TAG,
                        "transfer ended early");
    esp_err_t err = esp_partition_write(s_part, 0, s_head, MEDIA_HEADER_BYTES);
    free(s_head);
    s_head = NULL;
    ESP_RETURN_ON_ERROR(err, TAG, "header write");
    return media_load();
}
