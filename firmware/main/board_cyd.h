// Pin map for the ESP32-2432S028R ("Cheap Yellow Display", 2.8 in, 320x240).
// Taken from the common community pinout for this board. If your board is a
// different revision, these are the lines to check first.
#pragma once

#include "driver/gpio.h"
#include "driver/spi_master.h"

#define CYD_LCD_SPI_HOST   SPI2_HOST   // "HSPI" on the ESP32
#define CYD_LCD_PIN_SCLK   GPIO_NUM_14
#define CYD_LCD_PIN_MOSI   GPIO_NUM_13
#define CYD_LCD_PIN_MISO   GPIO_NUM_12
#define CYD_LCD_PIN_CS     GPIO_NUM_15
#define CYD_LCD_PIN_DC     GPIO_NUM_2
#define CYD_LCD_PIN_RST    GPIO_NUM_NC // screen reset is tied to the board's EN line
#define CYD_LCD_PIN_BL     GPIO_NUM_21 // backlight, high = on

// The panel is 240x320 portrait; we drive it in landscape.
#define CYD_LCD_WIDTH      320
#define CYD_LCD_HEIGHT     240
