// The screen's small web server, for changing the picture over Wi-Fi:
//   GET  /       the page the website opens to hand over a picture
//   GET  /info   what this screen is, as JSON
//   POST /media  a new media image (header + JPEG or GIF), as raw bytes
#pragma once

#include "esp_err.h"

esp_err_t web_start(void);
