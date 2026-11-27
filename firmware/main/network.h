// Wi-Fi for the player: joins the saved network, and listens on USB for
// Improv Serial so the website can set or change the Wi-Fi details.
#pragma once

#include <stdbool.h>
#include "esp_err.h"

#define ESPER_FIRMWARE_NAME "ESPER player"
#define ESPER_FIRMWARE_VERSION "1.1.0"

// Starts Wi-Fi and the Improv listener. NVS must be initialised first.
esp_err_t network_start(void);

// True while the screen has an address on the Wi-Fi.
bool network_connected(void);

// "http://192.168.1.23/" while connected, otherwise "".
const char *network_url(void);

// "esper-a1b2c3", also reachable as esper-a1b2c3.local.
const char *network_hostname(void);
