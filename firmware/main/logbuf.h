// Keeps the last few KB of the player's log in memory, so the website can read
// it over Wi-Fi (GET /log) when the screen isn't plugged in. Everything still
// goes to the USB serial port as well.
#pragma once

#include <stddef.h>
#include <stdint.h>

// Starts keeping log lines. Call first thing in app_main.
void logbuf_start(void);

// Copies log text written since `since` (a running byte count) into `out`.
// Sets `*start` to where the copy really begins (later than `since` if older
// text has been overwritten) and returns how many bytes it copied. The next
// call should pass `*start` plus that count.
size_t logbuf_read(uint32_t since, uint32_t *start, char *out, size_t size);

// The running byte count of everything logged so far.
uint32_t logbuf_written(void);
