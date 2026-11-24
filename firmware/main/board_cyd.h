// Pin map for the ESP32-2432S028R ("Cheap Yellow Display", 2.8 in, 320x240).
// Taken from the common community pinout for this board. If your board is a
// different revision, these are the lines to check first.
#pragma once

#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_lcd_ili9341.h"

#define BOARD_NAME          "2.8-inch ESP32-2432S028R"

#define BOARD_LCD_SPI_HOST  SPI2_HOST   // "HSPI" on the ESP32
#define BOARD_LCD_PIN_SCLK  GPIO_NUM_14
#define BOARD_LCD_PIN_MOSI  GPIO_NUM_13
#define BOARD_LCD_PIN_MISO  GPIO_NUM_12
#define BOARD_LCD_PIN_CS    GPIO_NUM_15
#define BOARD_LCD_PIN_DC    GPIO_NUM_2
#define BOARD_LCD_PIN_RST   GPIO_NUM_NC // screen reset is tied to the board's EN line
#define BOARD_LCD_PIN_BL    GPIO_NUM_21 // backlight, high = on

// No spare button. BOOT (GPIO 0) is kept for the factory reset (ASH-32).
#define BOARD_HAS_BUTTON    0

// The panel is 240x320 portrait; we drive it in landscape.
#define BOARD_LCD_WIDTH     320
#define BOARD_LCD_HEIGHT    240
#define BOARD_LCD_SWAP_XY   true
#define BOARD_LCD_GAP_X     0
#define BOARD_LCD_GAP_Y     0
#define board_lcd_new_panel esp_lcd_new_panel_ili9341
