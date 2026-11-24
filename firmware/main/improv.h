// Improv Serial (https://www.improv-wifi.com/serial/): the website sends the
// Wi-Fi name and password over USB during the first install, and gets back
// the address it uses to send pictures over Wi-Fi from then on.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef enum {
    IMPROV_STATE_READY = 0x02,
    IMPROV_STATE_PROVISIONING = 0x03,
    IMPROV_STATE_PROVISIONED = 0x04,
} improv_state_t;

typedef enum {
    IMPROV_ERROR_NONE = 0x00,
    IMPROV_ERROR_INVALID_RPC = 0x01,
    IMPROV_ERROR_UNKNOWN_RPC = 0x02,
    IMPROV_ERROR_UNABLE_TO_CONNECT = 0x03,
} improv_error_t;

typedef void (*improv_write_fn)(const uint8_t *data, size_t len);
typedef bool (*improv_wifi_fn)(const char *ssid, const char *password);
// Fills `urls` with up to `max` addresses for the website, and returns how many.
typedef int (*improv_urls_fn)(const char **urls, int max);

void improv_init(improv_write_fn write, improv_wifi_fn on_wifi, improv_urls_fn urls,
                 const char *firmware, const char *version, const char *chip, const char *device);
void improv_feed(uint8_t byte);
void improv_set_state(improv_state_t state);
void improv_set_error(improv_error_t error);
