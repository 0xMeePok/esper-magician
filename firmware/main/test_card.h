// A colour test card drawn in code, sized for whichever screen is built in.
// Use it to check the menuconfig colour, mirror and offset settings.
#pragma once

#include "esp_err.h"
#include "esp_lcd_panel_ops.h"

esp_err_t test_card_draw(esp_lcd_panel_handle_t panel);
