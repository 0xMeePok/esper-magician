// Wi-Fi for the player: joins the saved network, and listens on USB for
// Improv Serial so the website can set or change the Wi-Fi details. With no
// saved network, or one it can't join, it opens a setup hotspot (ESPER-xxxxxx)
// whose page (setup.html) takes the Wi-Fi details instead.
#pragma once

#include <stdbool.h>
#include "esp_err.h"
#include "esp_wifi_types.h"

#define ESPER_FIRMWARE_NAME "ESPER player"
#define ESPER_FIRMWARE_VERSION "1.6.0"

// The screen's own address on its setup hotspot.
#define NETWORK_SETUP_IP "192.168.4.1"

// Starts Wi-Fi and the Improv listener. NVS must be initialised first.
esp_err_t network_start(void);

// True while the screen has an address on the Wi-Fi.
bool network_connected(void);

// "http://192.168.1.23/" while connected, otherwise "".
const char *network_url(void);

// "esper-a1b2c3", also reachable as esper-a1b2c3.local.
const char *network_hostname(void);

// "http://esper-a1b2c3.local/".
const char *network_local_url(void);

typedef enum { SETUP_IDLE, SETUP_JOINING, SETUP_JOINED, SETUP_FAILED } setup_state_t;

// True while the setup hotspot is on.
bool network_setup_active(void);

// The hotspot's name, e.g. "ESPER-A1B2C3".
const char *network_setup_name(void);

// How the last join from the setup page went, and which network it was.
setup_state_t network_setup_state(const char **ssid);

// After a failed join from the setup page, why: "wrong password", "network not
// found (out of range, or 5 GHz only)" or "the router didn't answer". Otherwise "".
const char *network_setup_problem(void);

// Joins `ssid` in the background; the setup page polls network_setup_state().
esp_err_t network_setup_join(const char *ssid, const char *password);

// Scans for networks. Fills `out` with up to `max` and returns how many.
int network_scan(wifi_ap_record_t *out, int max);
