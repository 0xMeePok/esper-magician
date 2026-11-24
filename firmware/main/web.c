#include "web.h"

#include <stdio.h>
#include <stdlib.h>
#include "board.h"
#include "esp_check.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "media.h"
#include "network.h"
#include "screen.h"

static const char *TAG = "web";

extern const char receiver_html_start[] asm("_binary_receiver_html_start");
extern const char receiver_html_end[] asm("_binary_receiver_html_end");

#define BAR_W (BOARD_LCD_WIDTH - 40)
#define BAR_H 10
#define BAR_X 20
#define BAR_Y ((BOARD_LCD_HEIGHT - BAR_H) / 2)

static esp_err_t page(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    // EMBED_TXTFILES adds a trailing NUL, which isn't part of the page.
    return httpd_resp_send(req, receiver_html_start, receiver_html_end - receiver_html_start - 1);
}

static esp_err_t info(httpd_req_t *req)
{
    char json[256];
    snprintf(json, sizeof(json),
             "{\"firmware\":\"%s\",\"version\":\"%s\",\"hostname\":\"%s\","
             "\"screen\":{\"width\":%d,\"height\":%d},\"capacity\":%lu}",
             ESPER_FIRMWARE_NAME, ESPER_FIRMWARE_VERSION, network_hostname(), BOARD_LCD_WIDTH,
             BOARD_LCD_HEIGHT, (unsigned long)media_capacity());
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t reply(httpd_req_t *req, const char *status, bool ok, const char *message)
{
    char json[160];
    snprintf(json, sizeof(json), "{\"ok\":%s,\"message\":\"%s\"}", ok ? "true" : "false", message);
    httpd_resp_set_status(req, status);
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

// A thin progress bar on the screen while a picture arrives.
static void draw_progress(uint32_t done, uint32_t total)
{
    int w = total ? (int)((uint64_t)BAR_W * done / total) : 0;
    if (w > 0) {
        screen_fill_rect(BAR_X, BAR_Y, w, BAR_H, 0xFFFF);
    }
}

static esp_err_t receive(httpd_req_t *req)
{
    uint32_t total = req->content_len;
    if (total <= 4096 || total > media_capacity()) {
        return reply(req, "413 Content Too Large", false, "That picture is too big for this screen.");
    }
    uint8_t *buf = malloc(4096);
    if (!buf) {
        return reply(req, "500 Internal Server Error", false, "The screen ran out of memory.");
    }

    media_lock();
    screen_fill(SCREEN_BACKGROUND);
    screen_fill_rect(BAR_X, BAR_Y, BAR_W, BAR_H, 0x4208); // dark grey track
    esp_err_t err = media_write_begin(total);
    uint32_t got = 0, drawn = 0;
    while (err == ESP_OK && got < total) {
        int n = httpd_req_recv(req, (char *)buf, 4096);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) {
            continue;
        }
        if (n <= 0) {
            err = ESP_FAIL;
            break;
        }
        err = media_write(buf, (uint32_t)n);
        got += (uint32_t)n;
        if (got - drawn >= total / 25 || got == total) {
            draw_progress(got, total);
            drawn = got;
        }
    }
    if (err == ESP_OK) {
        err = media_write_end();
    }
    media_unlock();
    free(buf);

    if (err != ESP_OK) {
        ESP_LOGW(TAG, "picture not saved: %s", esp_err_to_name(err));
        return reply(req, "400 Bad Request", false,
                     err == ESP_ERR_INVALID_CRC ? "The picture arrived damaged. Try again."
                     : err == ESP_ERR_INVALID_SIZE ? "That picture was made for a different screen."
                                                   : "The screen couldn’t save the picture.");
    }
    return reply(req, "200 OK", true, "Saved");
}

esp_err_t web_start(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size = 6144;
    config.recv_wait_timeout = 15;
    config.lru_purge_enable = true;
    httpd_handle_t server = NULL;
    ESP_RETURN_ON_ERROR(httpd_start(&server, &config), TAG, "start");

    const httpd_uri_t routes[] = {
        {.uri = "/", .method = HTTP_GET, .handler = page},
        {.uri = "/info", .method = HTTP_GET, .handler = info},
        {.uri = "/media", .method = HTTP_POST, .handler = receive},
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        ESP_RETURN_ON_ERROR(httpd_register_uri_handler(server, &routes[i]), TAG, "route");
    }
    return ESP_OK;
}
