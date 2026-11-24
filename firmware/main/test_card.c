// Layout, top to bottom:
//   - a white triangle in the top-left corner (shows mirroring)
//   - seven colour bars: white, yellow, cyan, green, magenta, red, blue
//     (red and blue swapped means the BGR setting is wrong; white looking
//     black means the invert setting is wrong)
//   - an eight-step grey ramp, black on the left
//   - a one-pixel white frame round the edge (a missing edge or a stripe of
//     noise means the screen offset is wrong)
#include "test_card.h"

#include "board.h"
#include "esp_check.h"
#include "screen.h"

#define WHITE   0xFFFF
#define BLACK   0x0000

static const uint16_t BARS[] = {
    0xFFFF, // white
    0xFFE0, // yellow
    0x07FF, // cyan
    0x07E0, // green
    0xF81F, // magenta
    0xF800, // red
    0x001F, // blue
};
#define BAR_COUNT (sizeof(BARS) / sizeof(BARS[0]))
#define GREY_STEPS 8

static uint16_t grey(int level, int steps)
{
    int v = level * 255 / (steps - 1);
    return (uint16_t)(((v >> 3) << 11) | ((v >> 2) << 5) | (v >> 3));
}

esp_err_t test_card_draw(void)
{
    const int w = BOARD_LCD_WIDTH, h = BOARD_LCD_HEIGHT;
    const int bars_top = h / 8;
    const int bars_h = h / 2;
    const int ramp_top = bars_top + bars_h + h / 16;
    const int ramp_h = h / 8;

    ESP_RETURN_ON_ERROR(screen_fill(BLACK), "card", "fill");

    // Corner marker, one row at a time.
    const int corner = bars_top - 4;
    for (int row = 0; row < corner; row++) {
        ESP_RETURN_ON_ERROR(screen_fill_rect(0, row, corner - row, 1, WHITE), "card", "corner");
    }

    for (int i = 0; i < (int)BAR_COUNT; i++) {
        int x0 = i * w / (int)BAR_COUNT, x1 = (i + 1) * w / (int)BAR_COUNT;
        ESP_RETURN_ON_ERROR(screen_fill_rect(x0, bars_top, x1 - x0, bars_h, BARS[i]),
                            "card", "bar");
    }

    for (int i = 0; i < GREY_STEPS; i++) {
        int x0 = i * w / GREY_STEPS, x1 = (i + 1) * w / GREY_STEPS;
        ESP_RETURN_ON_ERROR(screen_fill_rect(x0, ramp_top, x1 - x0, ramp_h,
                                          grey(i, GREY_STEPS)), "card", "ramp");
    }

    // Frame, drawn last so it sits on top of everything.
    ESP_RETURN_ON_ERROR(screen_fill_rect(0, 0, w, 1, WHITE), "card", "frame");
    ESP_RETURN_ON_ERROR(screen_fill_rect(0, h - 1, w, 1, WHITE), "card", "frame");
    ESP_RETURN_ON_ERROR(screen_fill_rect(0, 0, 1, h, WHITE), "card", "frame");
    ESP_RETURN_ON_ERROR(screen_fill_rect(w - 1, 0, 1, h, WHITE), "card", "frame");
    return ESP_OK;
}
