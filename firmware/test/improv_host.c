// Runs the player's Improv Serial code on a computer: bytes in on stdin,
// replies out on stdout. Wi-Fi called "home" with password "secret" joins;
// anything else fails.
//
//   cc -I main test/improv_host.c main/improv.c -o improv_host
#include <stdio.h>
#include <string.h>
#include "improv.h"

static bool joined;

static void write_out(const uint8_t *data, size_t len)
{
    fwrite(data, 1, len, stdout);
}

static bool join(const char *ssid, const char *password)
{
    joined = strcmp(ssid, "home") == 0 && strcmp(password, "secret") == 0;
    return joined;
}

static int urls(const char **out, int max)
{
    if (!joined || max < 2) {
        return 0;
    }
    out[0] = "http://192.168.1.23/";
    out[1] = "http://esper-a1b2c3.local/";
    return 2;
}

int main(void)
{
    improv_init(write_out, join, urls, "ESPER player", "1.0.0", "ESP32", "ESPER 1.9-inch screen");
    int c;
    while ((c = getchar()) != EOF) {
        improv_feed((uint8_t)c);
    }
    return 0;
}
