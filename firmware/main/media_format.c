#include "media_format.h"

#include <string.h>

static uint16_t le16(const uint8_t *p)
{
    return (uint16_t)(p[0] | (p[1] << 8));
}

static uint32_t le32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

media_header_result_t media_header_parse(const uint8_t *b, size_t len, uint32_t capacity,
                                         media_header_t *out)
{
    if (len < 20 || memcmp(b, "ESPM", 4) != 0) {
        return MEDIA_HEADER_EMPTY;
    }
    if (le16(b + 4) != MEDIA_VERSION) {
        return MEDIA_HEADER_VERSION;
    }
    uint16_t kind = le16(b + 6);
    out->kind = (media_kind_t)kind;
    out->screen_width = le16(b + 8);
    out->screen_height = le16(b + 10);
    out->length = le32(b + 12);
    out->crc32 = le32(b + 16);
    if ((kind != MEDIA_KIND_JPEG && kind != MEDIA_KIND_GIF) || out->length == 0 ||
        capacity < MEDIA_HEADER_BYTES || out->length > capacity - MEDIA_HEADER_BYTES) {
        return MEDIA_HEADER_BAD;
    }
    return MEDIA_HEADER_OK;
}

uint32_t media_next_offset(const uint8_t *b, size_t len, const media_header_t *header,
                           uint32_t at)
{
    if (len < 24 || memcmp(b + 20, "NEXT", 4) != 0) {
        return 0;
    }
    uint32_t end = at + MEDIA_HEADER_BYTES + header->length;
    return (end + MEDIA_HEADER_BYTES - 1) / MEDIA_HEADER_BYTES * MEDIA_HEADER_BYTES;
}

uint32_t media_crc32(uint32_t crc, const uint8_t *data, size_t len)
{
    static uint32_t table[256];
    if (table[1] == 0) {
        for (uint32_t i = 0; i < 256; i++) {
            uint32_t c = i;
            for (int k = 0; k < 8; k++) {
                c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
            }
            table[i] = c;
        }
    }
    crc = ~crc;
    for (size_t i = 0; i < len; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
    }
    return ~crc;
}
