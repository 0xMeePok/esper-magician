// The media image the website writes into the "media" partition (ASH-19).
// Plain C with no ESP-IDF headers, so the tests can use it on a computer.
//
// Keep in step with src/flash/mediaImage.ts.
//
// Layout, all numbers little-endian:
//   0x0000  char     magic[4]      "ESPM"
//   0x0004  uint16_t version       1
//   0x0006  uint16_t kind          1 = JPEG picture, 2 = GIF animation,
//                                  3 = text design (scene_format.h)
//   0x0008  uint16_t screen_width  the screen it was made for, e.g. 170
//   0x000A  uint16_t screen_height e.g. 320
//   0x000C  uint32_t length        payload bytes
//   0x0010  uint32_t crc32         CRC-32 (as in zlib) of the payload
//   0x0014  char     next[4]       "NEXT" when another media image follows this
//                                  one, at the first 4 KB boundary after its
//                                  payload; anything else (the website writes
//                                  0xFF) means this is the last one
//   0x0018  ...                    0xFF up to 0x1000
//   0x1000  payload                the JPEG or GIF file, or the design
//
// Several images in a row make a playlist; the button steps through them.
#pragma once

#include <stddef.h>
#include <stdint.h>

#define MEDIA_HEADER_BYTES 4096
#define MEDIA_VERSION 1

typedef enum {
    MEDIA_KIND_JPEG = 1,
    MEDIA_KIND_GIF = 2,
    MEDIA_KIND_SCENE = 3,
} media_kind_t;

typedef struct {
    media_kind_t kind;
    uint16_t screen_width;
    uint16_t screen_height;
    uint32_t length;
    uint32_t crc32;
} media_header_t;

typedef enum {
    MEDIA_HEADER_OK = 0,
    MEDIA_HEADER_EMPTY,     // nothing has been written yet (no magic)
    MEDIA_HEADER_VERSION,   // made by a newer website
    MEDIA_HEADER_BAD,       // damaged
} media_header_result_t;

// Checks the first bytes of the partition. `capacity` is the partition size.
media_header_result_t media_header_parse(const uint8_t *bytes, size_t len, uint32_t capacity,
                                         media_header_t *out);

// Where the next media image starts (from the start of the partition), given
// the header at `at`, or 0 when this one is the last.
uint32_t media_next_offset(const uint8_t *bytes, size_t len, const media_header_t *header,
                           uint32_t at);

// CRC-32 as used by zlib and PNG. Start with crc = 0, and feed the data in
// pieces by passing the previous result back in.
uint32_t media_crc32(uint32_t crc, const uint8_t *data, size_t len);
