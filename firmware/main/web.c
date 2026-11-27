#include "web.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
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
extern const char setup_html_start[] asm("_binary_setup_html_start");
extern const char setup_html_end[] asm("_binary_setup_html_end");

#define BAR_W (BOARD_LCD_WIDTH - 40)
#define BAR_H 10
#define BAR_X 20
#define BAR_Y ((BOARD_LCD_HEIGHT - BAR_H) / 2)

// The website calls /info and /media straight from its own page (Chrome's
// Local Network Access), so those answer CORS for the site's own addresses
// only: the live site, its Vercel previews, and localhost while developing.
// Keep in step with allowed() in receiver.html.
#define SITE "https://esper-magician.vercel.app"
#define PREVIEW_PREFIX "https://esper-magician-"
#define PREVIEW_SUFFIX ".vercel.app"

static bool digits_or_empty_port(const char *rest)
{
    if (*rest == '\0') {
        return true;
    }
    if (*rest++ != ':' || *rest == '\0') {
        return false;
    }
    for (; *rest; rest++) {
        if (!isdigit((unsigned char)*rest)) {
            return false;
        }
    }
    return true;
}

static bool allowed_origin(const char *origin)
{
    if (strcmp(origin, SITE) == 0) {
        return true;
    }
    size_t len = strlen(origin), pre = strlen(PREVIEW_PREFIX), suf = strlen(PREVIEW_SUFFIX);
    if (len > pre + suf && strncmp(origin, PREVIEW_PREFIX, pre) == 0 &&
        strcmp(origin + len - suf, PREVIEW_SUFFIX) == 0) {
        for (size_t i = pre; i < len - suf; i++) {
            char c = origin[i];
            if (!(islower((unsigned char)c) || isdigit((unsigned char)c) || c == '-')) {
                return false;
            }
        }
        return true;
    }
    if (strncmp(origin, "http://localhost", 16) == 0) {
        return digits_or_empty_port(origin + 16);
    }
    if (strncmp(origin, "http://127.0.0.1", 16) == 0) {
        return digits_or_empty_port(origin + 16);
    }
    return false;
}

// Adds the CORS headers when the request comes from the website. The origin
// is copied into `buf`, which must outlive the response.
static void allow_site(httpd_req_t *req, char *buf, size_t size)
{
    if (httpd_req_get_hdr_value_str(req, "Origin", buf, size) != ESP_OK || !allowed_origin(buf)) {
        return;
    }
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", buf);
    httpd_resp_set_hdr(req, "Vary", "Origin");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Private-Network", "true");
}

// The browser's check before a POST from another origin.
static esp_err_t preflight(httpd_req_t *req)
{
    char origin[96];
    allow_site(req, origin, sizeof(origin));
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_set_hdr(req, "Access-Control-Max-Age", "600");
    httpd_resp_set_status(req, "204 No Content");
    return httpd_resp_send(req, NULL, 0);
}

static esp_err_t reply(httpd_req_t *req, const char *status, bool ok, const char *message);

static esp_err_t send_html(httpd_req_t *req, const char *start, const char *end)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    // EMBED_TXTFILES adds a trailing NUL, which isn't part of the page.
    return httpd_resp_send(req, start, end - start - 1);
}

static esp_err_t setup_page(httpd_req_t *req)
{
    return send_html(req, setup_html_start, setup_html_end);
}

// The receiving page, or the setup page while the screen has no Wi-Fi.
static esp_err_t page(httpd_req_t *req)
{
    if (network_setup_active() && !network_connected()) {
        return setup_page(req);
    }
    return send_html(req, receiver_html_start, receiver_html_end);
}

// ---- Setup hotspot ----

// Copies `in` into a JSON string body (without the quotes).
static void json_escape(char *out, size_t size, const char *in)
{
    size_t o = 0;
    for (; *in && o + 7 < size; in++) {
        unsigned char c = (unsigned char)*in;
        if (c == '"' || c == '\\') {
            out[o++] = '\\';
            out[o++] = (char)c;
        } else if (c < 0x20) {
            o += snprintf(out + o, size - o, "\\u%04x", c);
        } else {
            out[o++] = (char)c;
        }
    }
    out[o] = '\0';
}

// Decodes a form value in place: "+" is a space and "%41" is "A".
static void form_decode(char *s)
{
    char *out = s;
    for (; *s; s++) {
        if (*s == '+') {
            *out++ = ' ';
        } else if (*s == '%' && isxdigit((unsigned char)s[1]) && isxdigit((unsigned char)s[2])) {
            char hex[3] = {s[1], s[2], 0};
            *out++ = (char)strtol(hex, NULL, 16);
            s += 2;
        } else {
            *out++ = *s;
        }
    }
    *out = '\0';
}

static esp_err_t scan(httpd_req_t *req)
{
    wifi_ap_record_t *found = calloc(20, sizeof(wifi_ap_record_t));
    if (!found) {
        return httpd_resp_send_500(req);
    }
    int n = network_scan(found, 20);
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_sendstr_chunk(req, "[");
    bool first = true;
    for (int i = 0; i < n; i++) {
        const char *name = (const char *)found[i].ssid;
        bool seen = !name[0];
        for (int k = 0; k < i && !seen; k++) {
            seen = strcmp(name, (const char *)found[k].ssid) == 0; // strongest first
        }
        if (seen) {
            continue;
        }
        char escaped[200], item[260];
        json_escape(escaped, sizeof(escaped), name);
        snprintf(item, sizeof(item), "%s{\"ssid\":\"%s\",\"rssi\":%d,\"locked\":%s}", first ? "" : ",", escaped,
                 found[i].rssi, found[i].authmode == WIFI_AUTH_OPEN ? "false" : "true");
        httpd_resp_sendstr_chunk(req, item);
        first = false;
    }
    free(found);
    httpd_resp_sendstr_chunk(req, "]");
    return httpd_resp_sendstr_chunk(req, NULL);
}

static esp_err_t wifi_details(httpd_req_t *req)
{
    char body[256], ssid[100] = "", password[200] = "";
    if (req->content_len >= sizeof(body)) {
        return reply(req, "413 Content Too Large", false, "Those details are too long.");
    }
    int got = 0;
    while (got < (int)req->content_len) {
        int n = httpd_req_recv(req, body + got, req->content_len - got);
        if (n <= 0) {
            return reply(req, "400 Bad Request", false, "The details didn't arrive.");
        }
        got += n;
    }
    body[got] = '\0';
    httpd_query_key_value(body, "ssid", ssid, sizeof(ssid));
    httpd_query_key_value(body, "password", password, sizeof(password));
    form_decode(ssid);
    form_decode(password);
    esp_err_t err = network_setup_join(ssid, password);
    memset(password, 0, sizeof(password));
    memset(body, 0, sizeof(body));
    if (err != ESP_OK) {
        return reply(req, "400 Bad Request", false, "Check the network name and password.");
    }
    return reply(req, "202 Accepted", true, "Joining");
}

static esp_err_t setup_status(httpd_req_t *req)
{
    static const char *const names[] = {"idle", "joining", "joined", "failed"};
    const char *ssid = "";
    setup_state_t state = network_setup_state(&ssid);
    char escaped[200], json[400];
    json_escape(escaped, sizeof(escaped), ssid);
    snprintf(json, sizeof(json),
             "{\"setup\":%s,\"hotspot\":\"%s\",\"state\":\"%s\",\"ssid\":\"%s\",\"url\":\"%s\",\"local\":\"%s\"}",
             network_setup_active() ? "true" : "false", network_setup_name(), names[state], escaped,
             network_url(), network_local_url());
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, json);
}

// While the hotspot is on, every other address goes to the setup page. Phones
// check a fixed address when they join a network; the redirect makes them
// show the page on their own.
static esp_err_t not_found(httpd_req_t *req, httpd_err_code_t code)
{
    if (!network_setup_active()) {
        return httpd_resp_send_err(req, HTTPD_404_NOT_FOUND, "Not found");
    }
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", "http://" NETWORK_SETUP_IP "/setup");
    return httpd_resp_send(req, NULL, 0);
}

static esp_err_t info(httpd_req_t *req)
{
    char origin[96];
    allow_site(req, origin, sizeof(origin));
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
    char origin[96];
    allow_site(req, origin, sizeof(origin));
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
    config.max_uri_handlers = 12;
    httpd_handle_t server = NULL;
    ESP_RETURN_ON_ERROR(httpd_start(&server, &config), TAG, "start");

    const httpd_uri_t routes[] = {
        {.uri = "/", .method = HTTP_GET, .handler = page},
        {.uri = "/info", .method = HTTP_GET, .handler = info},
        {.uri = "/media", .method = HTTP_POST, .handler = receive},
        {.uri = "/info", .method = HTTP_OPTIONS, .handler = preflight},
        {.uri = "/media", .method = HTTP_OPTIONS, .handler = preflight},
        {.uri = "/setup", .method = HTTP_GET, .handler = setup_page},
        {.uri = "/scan", .method = HTTP_GET, .handler = scan},
        {.uri = "/wifi", .method = HTTP_POST, .handler = wifi_details},
        {.uri = "/status", .method = HTTP_GET, .handler = setup_status},
    };
    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        ESP_RETURN_ON_ERROR(httpd_register_uri_handler(server, &routes[i]), TAG, "route");
    }
    httpd_register_err_handler(server, HTTPD_404_NOT_FOUND, not_found);
    return ESP_OK;
}
