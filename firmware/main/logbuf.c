#include "logbuf.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

#define LOG_BYTES 8192 // about 100 lines

static char s_ring[LOG_BYTES];
static uint32_t s_written; // bytes ever written; s_ring holds the last LOG_BYTES of them
static char s_line[256];   // one formatted line, under s_lock
static SemaphoreHandle_t s_lock;
static vprintf_like_t s_uart; // ESP-IDF's own output, to the USB serial port

static void append(const char *text, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        s_ring[(s_written + i) % LOG_BYTES] = text[i];
    }
    s_written += len;
}

static int keep(const char *format, va_list args)
{
    va_list copy;
    va_copy(copy, args);
    // Logging never waits on the website: if the buffer is busy, this line is
    // only on USB.
    if (s_lock && xSemaphoreTake(s_lock, pdMS_TO_TICKS(5)) == pdTRUE) {
        int n = vsnprintf(s_line, sizeof(s_line), format, copy);
        if (n > 0) {
            append(s_line, n < (int)sizeof(s_line) ? (size_t)n : sizeof(s_line) - 1);
        }
        xSemaphoreGive(s_lock);
    }
    va_end(copy);
    return s_uart(format, args);
}

void logbuf_start(void)
{
    s_lock = xSemaphoreCreateMutex();
    if (s_lock) {
        s_uart = esp_log_set_vprintf(keep);
    }
}

uint32_t logbuf_written(void)
{
    return s_written;
}

size_t logbuf_read(uint32_t since, uint32_t *start, char *out, size_t size)
{
    size_t n = 0;
    if (!s_lock) {
        *start = 0;
        return 0;
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    uint32_t oldest = s_written > LOG_BYTES ? s_written - LOG_BYTES : 0;
    uint32_t from = since < oldest || since > s_written ? oldest : since;
    for (; from + n < s_written && n < size; n++) {
        out[n] = s_ring[(from + n) % LOG_BYTES];
    }
    xSemaphoreGive(s_lock);
    *start = from;
    return n;
}
