// Picks the pin map for the board chosen in `idf.py menuconfig` -> "ESPER screen".
#pragma once

#include "sdkconfig.h"

#if CONFIG_ESPER_BOARD_DEVKIT_1_9
#include "board_devkit_st7789.h"
#else
#include "board_cyd.h"
#endif
