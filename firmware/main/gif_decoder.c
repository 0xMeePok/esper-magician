#include "gif_decoder.h"

#include <stddef.h>
#include <string.h>

#define NO_CODE 0xFFFF

static int read_byte(gif_t *g)
{
    if (g->pos < g->buf_start || g->pos >= g->buf_start + g->buf_len) {
        if (g->pos >= g->size) {
            return -1;
        }
        uint32_t n = g->size - g->pos;
        if (n > sizeof(g->buf)) {
            n = sizeof(g->buf);
        }
        if (!g->read(g->read_ctx, g->pos, g->buf, n)) {
            return -2;
        }
        g->buf_start = g->pos;
        g->buf_len = n;
    }
    return g->buf[g->pos++ - g->buf_start];
}

static int read_u16(gif_t *g)
{
    int lo = read_byte(g);
    int hi = read_byte(g);
    if (lo < 0 || hi < 0) {
        return -1;
    }
    return lo | (hi << 8);
}

static int read_colors(gif_t *g, uint16_t *out, int count)
{
    for (int i = 0; i < count; i++) {
        int r = read_byte(g), gr = read_byte(g), b = read_byte(g);
        if (r < 0 || gr < 0 || b < 0) {
            return GIF_ERR_FORMAT;
        }
        out[i] = gif_rgb565((uint8_t)r, (uint8_t)gr, (uint8_t)b);
    }
    for (int i = count; i < 256; i++) {
        out[i] = 0;
    }
    return GIF_OK;
}

// Skips data sub-blocks up to and including the zero-length terminator.
static int skip_sub_blocks(gif_t *g)
{
    for (;;) {
        int len = read_byte(g);
        if (len < 0) {
            return GIF_ERR_FORMAT;
        }
        if (len == 0) {
            return GIF_OK;
        }
        g->pos += (uint32_t)len;
    }
}

int gif_open(gif_t *g, gif_read_fn read, void *ctx, uint32_t size)
{
    memset(g, 0, offsetof(gif_t, local_colors));
    g->read = read;
    g->read_ctx = ctx;
    g->size = size;
    g->next_transparent = -1;

    uint8_t sig[6];
    for (int i = 0; i < 6; i++) {
        int c = read_byte(g);
        if (c < 0) {
            return c == -2 ? GIF_ERR_READ : GIF_ERR_FORMAT;
        }
        sig[i] = (uint8_t)c;
    }
    if (memcmp(sig, "GIF87a", 6) != 0 && memcmp(sig, "GIF89a", 6) != 0) {
        return GIF_ERR_FORMAT;
    }
    int w = read_u16(g), h = read_u16(g);
    int packed = read_byte(g);
    if (w <= 0 || h <= 0 || packed < 0 || read_byte(g) < 0 || read_byte(g) < 0) {
        return GIF_ERR_FORMAT;
    }
    g->width = (uint16_t)w;
    g->height = (uint16_t)h;
    if (packed & 0x80) {
        g->has_global = true;
        int err = read_colors(g, g->global_colors, 1 << ((packed & 7) + 1));
        if (err) {
            return err;
        }
    }
    g->first_block = g->pos;
    return GIF_OK;
}

// Hands one finished row to the caller, split into runs of opaque pixels.
static void emit_row(gif_t *g, const gif_frame_t *f, int y, int transparent,
                     gif_row_fn row, void *ctx)
{
    int w = f->w;
    if (transparent < 0) {
        row(ctx, f->x, f->y + y, w, g->row);
        return;
    }
    int start = -1;
    for (int i = 0; i <= w; i++) {
        bool opaque = i < w && g->row_index[i] != transparent;
        if (opaque && start < 0) {
            start = i;
        } else if (!opaque && start >= 0) {
            row(ctx, f->x + start, f->y + y, i - start, g->row + start);
            start = -1;
        }
    }
}

// Row number in the image for the n-th decoded row of an interlaced frame.
static int interlaced_row(int n, int h)
{
    int pass1 = (h + 7) / 8;
    if (n < pass1) {
        return n * 8;
    }
    n -= pass1;
    int pass2 = (h + 3) / 8;
    if (n < pass2) {
        return 4 + n * 8;
    }
    n -= pass2;
    int pass3 = (h + 1) / 4;
    if (n < pass3) {
        return 2 + n * 4;
    }
    n -= pass3;
    return 1 + n * 2;
}

// Next byte of LZW data, crossing sub-block boundaries. -1 at the end.
static int data_byte(gif_t *g)
{
    if (g->block_left == 0) {
        int len = read_byte(g);
        if (len <= 0) {
            g->block_left = -1; // terminator reached
            return -1;
        }
        g->block_left = len;
    }
    if (g->block_left < 0) {
        return -1;
    }
    g->block_left--;
    return read_byte(g);
}

static int decode_image(gif_t *g, gif_frame_t *f, bool interlaced, const uint16_t *colors,
                        int transparent, gif_row_fn row, void *ctx)
{
    int min_size = read_byte(g);
    if (min_size < 2 || min_size > 8) {
        return GIF_ERR_FORMAT;
    }
    const int clear = 1 << min_size;
    const int eoi = clear + 1;
    int code_size = min_size + 1;
    int code_mask = (1 << code_size) - 1;
    int avail = clear + 2;
    int old = -1;
    uint8_t first = 0;
    for (int i = 0; i < clear; i++) {
        g->prefix[i] = NO_CODE;
        g->suffix[i] = (uint8_t)i;
    }

    uint32_t datum = 0;
    int bits = 0;
    int col = 0, rows_done = 0;
    const int w = f->w, h = f->h;
    g->block_left = 0;

    while (rows_done < h) {
        while (bits < code_size) {
            int b = data_byte(g);
            if (b < 0) {
                goto done; // data ended early; keep the rows we have
            }
            datum |= (uint32_t)b << bits;
            bits += 8;
        }
        int code = (int)(datum & (uint32_t)code_mask);
        datum >>= code_size;
        bits -= code_size;

        if (code == clear) {
            code_size = min_size + 1;
            code_mask = (1 << code_size) - 1;
            avail = clear + 2;
            old = -1;
            continue;
        }
        if (code == eoi) {
            break;
        }

        int sp = 0;
        if (old < 0) {
            if (code >= clear) {
                return GIF_ERR_FORMAT;
            }
            g->stack[sp++] = g->suffix[code];
            first = g->suffix[code];
            old = code;
        } else {
            int in = code;
            if (code > avail) {
                return GIF_ERR_FORMAT;
            }
            if (code == avail) {
                g->stack[sp++] = first;
                code = old;
            }
            while (code >= clear) {
                if (sp >= 4096) {
                    return GIF_ERR_FORMAT;
                }
                g->stack[sp++] = g->suffix[code];
                code = g->prefix[code];
            }
            first = g->suffix[code];
            g->stack[sp++] = first;
            if (avail < 4096) {
                g->prefix[avail] = (uint16_t)old;
                g->suffix[avail] = first;
                avail++;
                if ((avail & code_mask) == 0 && avail < 4096) {
                    code_size++;
                    code_mask = (1 << code_size) - 1;
                }
            }
            old = in;
        }

        while (sp > 0 && rows_done < h) {
            uint8_t index = g->stack[--sp];
            g->row_index[col] = index;
            g->row[col] = colors[index];
            if (++col == w) {
                int y = interlaced ? interlaced_row(rows_done, h) : rows_done;
                emit_row(g, f, y, transparent, row, ctx);
                col = 0;
                rows_done++;
            }
        }
    }

done:
    // Skip whatever is left of the image data.
    if (g->block_left > 0) {
        g->pos += (uint32_t)g->block_left;
        g->block_left = 0;
    }
    if (g->block_left == 0) {
        return skip_sub_blocks(g);
    }
    return GIF_OK;
}

int gif_next_frame(gif_t *g, gif_frame_t *f, gif_row_fn row, void *ctx)
{
    bool looped = false;
    for (;;) {
        int b = read_byte(g);
        if (b == -2) {
            return GIF_ERR_READ;
        }
        if (b < 0 || b == 0x3B) {
            // End of the file: start the next loop.
            if (!g->any_frame) {
                return GIF_ERR_NO_FRAMES;
            }
            if (looped) {
                return GIF_ERR_FORMAT; // a whole pass with no frames
            }
            g->pos = g->first_block;
            g->frames_seen = 0;
            g->next_delay_ms = 0;
            g->next_transparent = -1;
            looped = true;
            continue;
        }
        if (b == 0x21) {
            int label = read_byte(g);
            if (label == 0xF9) {
                int len = read_byte(g);
                int packed = read_byte(g);
                int delay = read_u16(g);
                int transparent = read_byte(g);
                if (len != 4 || packed < 0 || delay < 0 || transparent < 0) {
                    return GIF_ERR_FORMAT;
                }
                g->next_delay_ms = (uint16_t)(delay * 10);
                g->next_transparent = (packed & 1) ? transparent : -1;
                if (skip_sub_blocks(g)) {
                    return GIF_ERR_FORMAT;
                }
            } else if (label < 0 || skip_sub_blocks(g)) {
                return GIF_ERR_FORMAT;
            }
            continue;
        }
        if (b != 0x2C) {
            return GIF_ERR_FORMAT;
        }

        int x = read_u16(g), y = read_u16(g), w = read_u16(g), h = read_u16(g);
        int packed = read_byte(g);
        if (x < 0 || y < 0 || w <= 0 || h <= 0 || packed < 0) {
            return GIF_ERR_FORMAT;
        }
        if (w > GIF_MAX_WIDTH) {
            return GIF_ERR_TOO_WIDE;
        }
        const uint16_t *colors = g->global_colors;
        if (packed & 0x80) {
            int err = read_colors(g, g->local_colors, 1 << ((packed & 7) + 1));
            if (err) {
                return err;
            }
            colors = g->local_colors;
        } else if (!g->has_global) {
            return GIF_ERR_FORMAT;
        }

        f->x = (uint16_t)x;
        f->y = (uint16_t)y;
        f->w = (uint16_t)w;
        f->h = (uint16_t)h;
        f->delay_ms = g->next_delay_ms < 20 ? 100 : g->next_delay_ms;
        f->looped = g->frames_seen == 0 && g->any_frame;
        int transparent = g->next_transparent;
        g->next_delay_ms = 0;
        g->next_transparent = -1;

        int err = decode_image(g, f, (packed & 0x40) != 0, colors, transparent, row, ctx);
        if (err) {
            return err;
        }
        g->any_frame = true;
        g->frames_seen++;
        return GIF_OK;
    }
}
