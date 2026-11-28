// Plays a text design (a scene, see scene_format.h) from the media partition:
// draws its background, then moves and blinks its sprites, redrawing only the
// parts of the screen that change.
#pragma once

#include <stdint.h>
#include "esp_err.h"
#include "esp_partition.h"

// Maps the scene payload at `offset` (`length` bytes) of the partition into
// memory and checks it. The caller has already checked its CRC.
esp_err_t scene_open(const esp_partition_t *part, uint32_t offset, uint32_t length);

// Draws the whole screen and starts the scene's clock. `delay_ms` gets how
// long until something next changes, or 0 when nothing ever does.
esp_err_t scene_show(uint32_t *delay_ms);

// Redraws what has changed since the last call.
esp_err_t scene_next(uint32_t *delay_ms);

// The backlight brightness the open scene asks for, in percent.
int scene_brightness(void);

// Frees the scene, if one is open.
void scene_close(void);
