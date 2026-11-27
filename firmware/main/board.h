// Pin map for the ESPER screen: a 1.9-inch ST7789 (170x320) wired to an ESP32
// DevKit, 38-pin or 30-pin (pick in `idf.py menuconfig` -> "ESPER screen").
// The wirings are in firmware/README.md. If you move a wire, change the
// matching line here and build again.
#pragma once

#include "sdkconfig.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_panel_vendor.h" // esp_lcd_new_panel_st7789, built into ESP-IDF

#if CONFIG_ESPER_BOARD_DEVKIT_30
#define BOARD_ID            "devkit-30"
#define BOARD_NAME          "1.9-inch ST7789 on an ESP32 DevKit 30-pin"
#else
#define BOARD_ID            "devkit-38"
#define BOARD_NAME          "1.9-inch ST7789 on an ESP32 DevKit 38-pin"
#endif

#define BOARD_LCD_SPI_HOST  SPI3_HOST   // "VSPI"; GPIO 18 and 23 are its own fast pins
#define BOARD_LCD_PIN_SCLK  GPIO_NUM_18 // screen SCL
#define BOARD_LCD_PIN_MOSI  GPIO_NUM_23 // screen SDA
#define BOARD_LCD_PIN_MISO  GPIO_NUM_NC // the screen never sends data back
#define BOARD_LCD_PIN_CS    GPIO_NUM_22 // screen CS
#define BOARD_LCD_PIN_DC    GPIO_NUM_21 // screen DC
#define BOARD_LCD_PIN_RST   GPIO_NUM_4  // screen RES
// On the 30-pin board GPIO 32 and 33 sit under the board on a breadboard, so
// the backlight and button move to GPIO 17 and 16.
#if CONFIG_ESPER_BOARD_DEVKIT_30
#define BOARD_LCD_PIN_BL    GPIO_NUM_17 // screen BLK, high = on
#else
#define BOARD_LCD_PIN_BL    GPIO_NUM_32 // screen BLK, high = on
#endif

// Push button between the button pin and GND. The internal pull-up holds it high.
#define BOARD_HAS_BUTTON    1
#if CONFIG_ESPER_BOARD_DEVKIT_30
#define BOARD_PIN_BUTTON    GPIO_NUM_16
#else
#define BOARD_PIN_BUTTON    GPIO_NUM_33
#endif

// Portrait, with the screen's pins along the bottom edge.
#define BOARD_LCD_WIDTH     170
#define BOARD_LCD_HEIGHT    320
#define BOARD_LCD_SWAP_XY   false
// The ST7789 has memory for 240 columns. This 170-pixel panel shows the
// middle 170, so drawing starts 35 columns in.
#define BOARD_LCD_GAP_X     35
#define BOARD_LCD_GAP_Y     0
#define board_lcd_new_panel esp_lcd_new_panel_st7789
