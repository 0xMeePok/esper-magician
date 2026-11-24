# ESP-IDF project for the ESPER screen: a 1.9-inch ST7789 on an ESP32 DevKit.
# Build with:  idf.py set-target esp32 && idf.py build
cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(esper_player)
