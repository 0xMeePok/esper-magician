#include "picture_player.h"

#include <string.h>
#include "board.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "picture";

// Rows sent per SPI transfer. Two buffers of this size live in DMA RAM, so one
// can be filled from flash while the other is going out to the screen.
#define CHUNK_ROWS 20
#define CHUNK_BYTES (BOARD_LCD_WIDTH * CHUNK_ROWS * 2)

#define HEADER_BYTES 12

static uint8_t *s_buf[2];
static SemaphoreHandle_t s_done;

static uint16_t read_le16(const uint8_t *p)
{
    return (uint16_t)(p[0] | (p[1] << 8));
}

bool cyd_picture_on_trans_done(esp_lcd_panel_io_handle_t io,
                               esp_lcd_panel_io_event_data_t *edata,
                               void *user_ctx)
{
    BaseType_t woken = pdFALSE;
    if (s_done) {
        xSemaphoreGiveFromISR(s_done, &woken);
    }
    return woken == pdTRUE;
}

esp_err_t cyd_picture_player_init(void)
{
    if (s_done) {
        return ESP_OK;
    }
    for (int i = 0; i < 2; i++) {
        s_buf[i] = heap_caps_malloc(CHUNK_BYTES, MALLOC_CAP_DMA);
        ESP_RETURN_ON_FALSE(s_buf[i], ESP_ERR_NO_MEM, TAG, "no DMA memory");
    }
    s_done = xSemaphoreCreateCounting(2, 0);
    ESP_RETURN_ON_FALSE(s_done, ESP_ERR_NO_MEM, TAG, "no semaphore");
    return ESP_OK;
}

esp_err_t cyd_picture_parse(const uint8_t *data, size_t len, cyd_picture_t *out)
{
    ESP_RETURN_ON_FALSE(len >= HEADER_BYTES && memcmp(data, "CYD1", 4) == 0,
                        ESP_ERR_INVALID_ARG, TAG, "not a CYD1 picture file");

    out->width = read_le16(data + 4);
    out->height = read_le16(data + 6);
    out->frame_count = read_le16(data + 8);
    ESP_RETURN_ON_FALSE(out->width > 0 && out->width <= BOARD_LCD_WIDTH &&
                        out->height > 0 && out->height <= BOARD_LCD_HEIGHT,
                        ESP_ERR_INVALID_ARG, TAG, "picture is %ux%u, screen is %ux%u",
                        out->width, out->height, BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT);
    ESP_RETURN_ON_FALSE(out->frame_count > 0, ESP_ERR_INVALID_ARG, TAG, "no frames");

    size_t frame_bytes = (size_t)out->width * out->height * 2;
    size_t need = HEADER_BYTES + (size_t)out->frame_count * 2 +
                  (size_t)out->frame_count * frame_bytes;
    ESP_RETURN_ON_FALSE(len >= need, ESP_ERR_INVALID_SIZE, TAG,
                        "file is %u bytes, header says %u", (unsigned)len, (unsigned)need);

    out->delays = data + HEADER_BYTES;
    out->pixels = out->delays + (size_t)out->frame_count * 2;
    return ESP_OK;
}

uint16_t cyd_picture_delay_ms(const cyd_picture_t *pic, uint16_t index)
{
    return read_le16(pic->delays + (size_t)index * 2);
}

// Sends `rows` rows of `width` pixels from `src` (flash) to the screen at
// (x0, y0), double-buffered through DMA RAM.
static esp_err_t send_rows(esp_lcd_panel_handle_t panel, int x0, int y0,
                           int width, int rows, const uint8_t *src)
{
    int rows_per_chunk = CHUNK_BYTES / (width * 2);
    int in_flight = 0;
    int n = 0;

    for (int row = 0; row < rows; row += rows_per_chunk, n++) {
        int count = rows - row < rows_per_chunk ? rows - row : rows_per_chunk;
        uint8_t *buf = s_buf[n & 1];

        if (in_flight == 2) {
            // Wait until the older transfer (using this buffer) is done.
            xSemaphoreTake(s_done, portMAX_DELAY);
            in_flight--;
        }
        if (src) {
            memcpy(buf, src + (size_t)row * width * 2, (size_t)count * width * 2);
        }
        ESP_RETURN_ON_ERROR(esp_lcd_panel_draw_bitmap(panel, x0, y0 + row,
                                                      x0 + width, y0 + row + count, buf),
                            TAG, "draw failed");
        in_flight++;
    }
    while (in_flight--) {
        xSemaphoreTake(s_done, portMAX_DELAY);
    }
    return ESP_OK;
}

esp_err_t cyd_picture_draw_frame(esp_lcd_panel_handle_t panel,
                                 const cyd_picture_t *pic, uint16_t index)
{
    ESP_RETURN_ON_FALSE(s_done, ESP_ERR_INVALID_STATE, TAG, "call cyd_picture_player_init first");
    ESP_RETURN_ON_FALSE(index < pic->frame_count, ESP_ERR_INVALID_ARG, TAG, "bad frame");

    size_t frame_bytes = (size_t)pic->width * pic->height * 2;
    const uint8_t *src = pic->pixels + (size_t)index * frame_bytes;
    int x0 = (BOARD_LCD_WIDTH - pic->width) / 2;
    int y0 = (BOARD_LCD_HEIGHT - pic->height) / 2;
    return send_rows(panel, x0, y0, pic->width, pic->height, src);
}

esp_err_t cyd_fill_rect(esp_lcd_panel_handle_t panel, int x, int y, int w, int h,
                        uint16_t rgb565)
{
    ESP_RETURN_ON_FALSE(s_done, ESP_ERR_INVALID_STATE, TAG, "call cyd_picture_player_init first");
    ESP_RETURN_ON_FALSE(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= BOARD_LCD_WIDTH &&
                        y + h <= BOARD_LCD_HEIGHT, ESP_ERR_INVALID_ARG, TAG, "rect off screen");
    // The screen wants big-endian pixels.
    uint8_t hi = rgb565 >> 8, lo = rgb565 & 0xff;
    for (int b = 0; b < 2; b++) {
        for (int i = 0; i < CHUNK_BYTES; i += 2) {
            s_buf[b][i] = hi;
            s_buf[b][i + 1] = lo;
        }
    }
    return send_rows(panel, x, y, w, h, NULL);
}

esp_err_t cyd_fill_screen(esp_lcd_panel_handle_t panel, uint16_t rgb565)
{
    return cyd_fill_rect(panel, 0, 0, BOARD_LCD_WIDTH, BOARD_LCD_HEIGHT, rgb565);
}
