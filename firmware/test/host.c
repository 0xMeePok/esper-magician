// Runs the player's media checks and GIF decoder on a computer.
//
//   cc -O2 -I main test/host.c main/gif_decoder.c main/media_format.c -o host
//   ./host media.bin frames.raw [frame_count]
//
// Reads a media image (as the website writes it), checks the header and CRC
// like the device does, and for a GIF draws frames onto a 170x320 screen
// exactly as media.c places them. Each screen is written to frames.raw as
// little-endian RGB565. Prints one line of JSON describing what it found.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gif_decoder.h"
#include "media_format.h"

#define W 170
#define H 320
#define BACKGROUND 0x2945
#define CAPACITY 0x230000 // the media partition in partitions.media.csv

typedef struct {
    const uint8_t *data;
    uint32_t size;
} source_t;

static uint16_t screen[W * H];
static int ox, oy;

static bool read_mem(void *ctx, uint32_t offset, uint8_t *buf, uint32_t len)
{
    source_t *s = ctx;
    if (offset > s->size || len > s->size - offset) {
        return false;
    }
    memcpy(buf, s->data + offset, len);
    return true;
}

static void put_row(void *ctx, int x, int y, int w, const uint16_t *px)
{
    for (int i = 0; i < w; i++) {
        int sx = ox + x + i, sy = oy + y;
        if (sx >= 0 && sx < W && sy >= 0 && sy < H) {
            screen[sy * W + sx] = px[i];
        }
    }
}

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s media.bin frames.raw [frame_count]\n", argv[0]);
        return 2;
    }
    FILE *f = fopen(argv[1], "rb");
    if (!f) {
        perror(argv[1]);
        return 2;
    }
    static uint8_t file[CAPACITY];
    size_t len = fread(file, 1, sizeof(file), f);
    fclose(f);

    media_header_t h;
    media_header_result_t r = media_header_parse(file, len, CAPACITY, &h);
    if (r != MEDIA_HEADER_OK) {
        printf("{\"header\":%d}\n", (int)r);
        return 1;
    }
    bool size_ok = len >= MEDIA_HEADER_BYTES + h.length;
    uint32_t crc = size_ok ? media_crc32(0, file + MEDIA_HEADER_BYTES, h.length) : 0;
    bool crc_ok = size_ok && crc == h.crc32;
    printf("{\"header\":0,\"kind\":%d,\"screen\":[%u,%u],\"length\":%u,\"crc_ok\":%s",
           (int)h.kind, h.screen_width, h.screen_height, h.length, crc_ok ? "true" : "false");
    if (!crc_ok || h.kind != MEDIA_KIND_GIF) {
        printf("}\n");
        return crc_ok ? 0 : 1;
    }

    source_t src = {file + MEDIA_HEADER_BYTES, h.length};
    static gif_t gif;
    int err = gif_open(&gif, read_mem, &src, h.length);
    if (err) {
        printf(",\"gif_error\":%d}\n", err);
        return 1;
    }
    ox = (W - gif.width) / 2;
    oy = (H - gif.height) / 2;
    int want = argc > 3 ? atoi(argv[3]) : 0;

    FILE *out = fopen(argv[2], "wb");
    for (int i = 0; i < W * H; i++) {
        screen[i] = BACKGROUND;
    }
    printf(",\"gif\":[%u,%u],\"delays\":[", gif.width, gif.height);
    int frames = 0;
    for (;;) {
        gif_frame_t frame;
        err = gif_next_frame(&gif, &frame, put_row, NULL);
        if (err) {
            printf("],\"gif_error\":%d}\n", err);
            fclose(out);
            return 1;
        }
        if (frame.looped && want == 0) {
            break; // one full loop
        }
        fwrite(screen, 2, W * H, out);
        printf("%s%u", frames ? "," : "", frame.delay_ms);
        if (++frames == want) {
            break;
        }
    }
    fclose(out);
    printf("],\"frames\":%d}\n", frames);
    return 0;
}
