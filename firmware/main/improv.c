#include "improv.h"
#include <string.h>

enum { TYPE_STATE = 0x01, TYPE_ERROR = 0x02, TYPE_RPC = 0x03, TYPE_RESULT = 0x04 };
enum { CMD_WIFI = 0x01, CMD_STATE = 0x02, CMD_INFO = 0x03 };

static const uint8_t HEADER[6] = {'I', 'M', 'P', 'R', 'O', 'V'};
static improv_write_fn s_write;
static improv_wifi_fn s_on_wifi;
static improv_urls_fn s_urls;
static const char *s_info[4];
static improv_state_t s_state = IMPROV_STATE_READY;
static uint8_t s_buf[256];
static size_t s_len;

static void send(uint8_t type, const uint8_t *data, uint8_t len) {
    if (!s_write) return;
    uint8_t packet[6 + 3 + 255 + 1];
    memcpy(packet, HEADER, 6);
    packet[6] = 1;  // protocol version
    packet[7] = type;
    packet[8] = len;
    memcpy(packet + 9, data, len);
    uint8_t sum = 0;
    for (size_t i = 0; i < 9u + len; i++) sum += packet[i];
    packet[9 + len] = sum;
    packet[10 + len] = '\n';
    s_write(packet, 11u + len);
}

static void send_strings(uint8_t command, const char *const *strings, int count) {
    uint8_t data[250];
    uint8_t at = 2;
    for (int i = 0; i < count; i++) {
        size_t n = strlen(strings[i]);
        if (at + 1 + n > sizeof data) break;
        data[at++] = (uint8_t)n;
        memcpy(data + at, strings[i], n);
        at += n;
    }
    data[0] = command;
    data[1] = at - 2;
    send(TYPE_RESULT, data, at);
}

void improv_set_state(improv_state_t state) {
    s_state = state;
    uint8_t value = (uint8_t)state;
    send(TYPE_STATE, &value, 1);
}

void improv_set_error(improv_error_t error) {
    uint8_t value = (uint8_t)error;
    send(TYPE_ERROR, &value, 1);
}

void improv_init(improv_write_fn write, improv_wifi_fn on_wifi, improv_urls_fn urls,
                 const char *firmware, const char *version, const char *chip, const char *device) {
    s_write = write;
    s_on_wifi = on_wifi;
    s_urls = urls;
    s_info[0] = firmware;
    s_info[1] = version;
    s_info[2] = chip;
    s_info[3] = device;
}

// Sends the device's addresses as the result of `command`.
static void send_urls(uint8_t command) {
    const char *urls[2];
    int count = s_urls ? s_urls(urls, 2) : 0;
    send_strings(command, urls, count);
}

static void handle_rpc(const uint8_t *data, uint8_t len) {
    if (len < 2 || data[1] + 2 > len) {
        improv_set_error(IMPROV_ERROR_INVALID_RPC);
        return;
    }
    switch (data[0]) {
        case CMD_STATE:
            improv_set_state(s_state);
            if (s_state == IMPROV_STATE_PROVISIONED) send_urls(CMD_STATE);
            break;
        case CMD_INFO:
            send_strings(CMD_INFO, s_info, 4);
            break;
        case CMD_WIFI: {
            const uint8_t *p = data + 2;
            uint8_t ssid_len = p[0];
            if (ssid_len + 2 > data[1]) {
                improv_set_error(IMPROV_ERROR_INVALID_RPC);
                return;
            }
            uint8_t pass_len = p[1 + ssid_len];
            if (ssid_len > 32 || pass_len > 64 || 2 + ssid_len + pass_len > data[1]) {
                improv_set_error(IMPROV_ERROR_INVALID_RPC);
                return;
            }
            char ssid[33] = {0};
            char pass[65] = {0};
            memcpy(ssid, p + 1, ssid_len);
            memcpy(pass, p + 2 + ssid_len, pass_len);
            improv_set_state(IMPROV_STATE_PROVISIONING);
            if (s_on_wifi(ssid, pass)) {
                improv_set_state(IMPROV_STATE_PROVISIONED);
                send_urls(CMD_WIFI);
            } else {
                improv_set_error(IMPROV_ERROR_UNABLE_TO_CONNECT);
                improv_set_state(IMPROV_STATE_READY);
            }
            break;
        }
        default:
            improv_set_error(IMPROV_ERROR_UNKNOWN_RPC);
    }
}

void improv_feed(uint8_t byte) {
    if (s_len < 6) {
        if (byte == HEADER[s_len]) s_buf[s_len++] = byte;
        else s_len = byte == HEADER[0] ? (s_buf[0] = byte, 1) : 0;
        return;
    }
    s_buf[s_len++] = byte;
    if (s_len < 9) return;
    size_t total = 9u + s_buf[8] + 1u;
    if (s_len < total) {
        if (s_len >= sizeof s_buf) s_len = 0;
        return;
    }
    uint8_t sum = 0;
    for (size_t i = 0; i < total - 1; i++) sum += s_buf[i];
    bool ok = sum == s_buf[total - 1] && s_buf[6] == 1;
    uint8_t type = s_buf[7];
    s_len = 0;
    if (!ok) {
        improv_set_error(IMPROV_ERROR_INVALID_RPC);
        return;
    }
    if (type == TYPE_RPC) handle_rpc(s_buf + 9, s_buf[8]);
}
