// Runs the player's text-design code (scene_format.c) on a computer.
//
//   cc -O2 -I main test/scene_host.c main/scene_format.c main/media_format.c -o scene_host
//   ./scene_host media.bin frames.raw t1 t2 ...
//
// Reads a media image holding a design, checks it like the device does, and
// draws the whole 170x320 screen at each time (in ms) the way scene.c does: the
// background, then every sprite (a GIF background shows as its colour). Each
// screen is written to frames.raw as little-endian RGB565. Prints one line of
// JSON: what it found, when each next change is due, and the area each sprite
// covers at each time.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "media_format.h"
#include "scene_format.h"

#define W 170
#define H 320
#define CAPACITY 0x230000

#define TILE_W 53
#define TILE_H 37

static uint16_t screen[W * H];
static uint16_t tile[TILE_W * TILE_H];

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s media.bin frames.raw [t ...]\n", argv[0]);
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
    if (len < MEDIA_HEADER_BYTES + h.length ||
        media_crc32(0, file + MEDIA_HEADER_BYTES, h.length) != h.crc32) {
        printf("{\"header\":0,\"kind\":%d,\"crc_ok\":false}\n", (int)h.kind);
        return 1;
    }
    const uint8_t *payload = file + MEDIA_HEADER_BYTES;
    static scene_t scene;
    int err = scene_parse(payload, h.length, W, H, &scene);
    printf("{\"header\":0,\"kind\":%d,\"crc_ok\":true,\"scene\":%d", (int)h.kind, err);
    if (err) {
        printf("}\n");
        return 1;
    }
    printf(",\"count\":%d,\"bg\":%d,\"brightness\":%d", scene.count, (int)scene.bg, scene.brightness);

    FILE *out = fopen(argv[2], "wb");
    int times = argc - 3;
    printf(",\"next\":[");
    for (int i = 0; i < times; i++) {
        uint32_t t = (uint32_t)strtoul(argv[3 + i], NULL, 10);
        uint32_t next = scene_next_change(&scene, t);
        printf(next == UINT32_MAX ? "%snull" : "%s%u", i ? "," : "", next);

        // In odd-sized tiles, like the player's bands and changed areas, so
        // drawing part of a sprite is checked too.
        for (int ty = 0; ty < H; ty += TILE_H) {
            for (int tx = 0; tx < W; tx += TILE_W) {
                int tw = W - tx < TILE_W ? W - tx : TILE_W, th = H - ty < TILE_H ? H - ty : TILE_H;
                for (int y = 0; y < th; y++) {
                    for (int x = 0; x < tw; x++) {
                        uint16_t c = scene.bg_color;
                        if (scene.bg == SCENE_BG_PICTURE) {
                            const uint8_t *p = payload + scene.bg_offset + ((size_t)(ty + y) * W + tx + x) * 2;
                            c = (uint16_t)(p[0] | (p[1] << 8));
                        }
                        tile[y * tw + x] = c;
                    }
                }
                scene_draw_sprites(&scene, payload, t, tx, ty, tw, th, tile);
                for (int y = 0; y < th; y++) {
                    memcpy(screen + (ty + y) * W + tx, tile + y * tw, (size_t)tw * 2);
                }
            }
        }
        fwrite(screen, 2, W * H, out);
    }
    printf("],\"areas\":[");
    for (int i = 0; i < times; i++) {
        uint32_t t = (uint32_t)strtoul(argv[3 + i], NULL, 10);
        printf("%s[", i ? "," : "");
        for (int s = 0; s < scene.count; s++) {
            scene_rect_t a = scene_sprite_area(&scene.sprites[s], t);
            printf("%s[%d,%d,%d,%d]", s ? "," : "", a.x, a.y, a.w, a.h);
        }
        printf("]");
    }
    printf("]}\n");
    fclose(out);
    return 0;
}
