# ESP-IDF project for the ESPER screens (2.8-inch ESP32-2432S028R, 1.9-inch ST7789 on an ESP32 DevKit).
# Build with:  idf.py set-target esp32 && idf.py build
cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(cyd_picture)
