// Pin map for the 1.9-inch ST7789 screen (170x320) wired to an ESP32 DevKit
// 38-pin (ESP32-WROOM-32E). The wiring is in firmware/README.md.
// If you move a wire, change the matching line here and build again.
#pragma once

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_panel_vendor.h" // esp_lcd_new_panel_st7789, built into ESP-IDF

#define BOARD_NAME          "1.9-inch ST7789 on an ESP32 DevKit"

#define BOARD_LCD_SPI_HOST  SPI3_HOST   // "VSPI"; GPIO 18 and 23 are its own fast pins
#define BOARD_LCD_PIN_SCLK  GPIO_NUM_18 // screen SCL
#define BOARD_LCD_PIN_MOSI  GPIO_NUM_23 // screen SDA
#define BOARD_LCD_PIN_MISO  GPIO_NUM_NC // the screen never sends data back
#define BOARD_LCD_PIN_CS    GPIO_NUM_22 // screen CS
#define BOARD_LCD_PIN_DC    GPIO_NUM_21 // screen DC
#define BOARD_LCD_PIN_RST   GPIO_NUM_4  // screen RES
#define BOARD_LCD_PIN_BL    GPIO_NUM_32 // screen BLK, high = on

// Push button between GPIO 33 and GND. The internal pull-up holds it high.
#define BOARD_HAS_BUTTON    1
#define BOARD_PIN_BUTTON    GPIO_NUM_33

// Portrait, with the screen's pins along the bottom edge.
#define BOARD_LCD_WIDTH     170
#define BOARD_LCD_HEIGHT    320
#define BOARD_LCD_SWAP_XY   false
// The ST7789 has memory for 240 columns. This 170-pixel panel shows the
// middle 170, so drawing starts 35 columns in.
#define BOARD_LCD_GAP_X     35
#define BOARD_LCD_GAP_Y     0
#define board_lcd_new_panel esp_lcd_new_panel_st7789
