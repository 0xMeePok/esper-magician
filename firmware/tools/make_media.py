#!/usr/bin/env python3
"""Wraps JPEGs or GIFs into a media image, the same way the website does.

    python tools/make_media.py picture.jpg [more.gif ...] media.bin
    python -m esptool --chip esp32 write_flash 0x1D0000 media.bin

Useful for trying pictures without the website. Each file must already be
sized for the screen (170x320 or smaller), and a JPEG must be baseline.

With several files, they are stored one after another as a playlist: every
header but the last says "NEXT" at byte 0x14, and the next picture starts at
the following 4 KB boundary. The button steps through them (firmware 1.5.0+).
Layout: see main/media_format.h.
"""

import struct
import sys
import zlib
from pathlib import Path

HEADER_BYTES = 4096
SCREEN = (170, 320)
MEDIA_BYTES = 0x230000  # the media partition, from partitions.media.csv


def pack(payload: bytes, kind: int, more: bool = False) -> bytes:
    header = b"ESPM" + struct.pack("<HHHHII", 1, kind, SCREEN[0], SCREEN[1], len(payload),
                                   zlib.crc32(payload) & 0xFFFFFFFF)
    if more:
        header += b"NEXT"
    return header + b"\xff" * (HEADER_BYTES - len(header)) + payload


def kind_of(payload: bytes, name: str) -> int:
    if payload[:6] in (b"GIF87a", b"GIF89a"):
        return 2
    if payload[:2] == b"\xff\xd8":
        return 1
    sys.exit(f"{name}: expected a JPEG or GIF file")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    *inputs, output = sys.argv[1:]
    image = b""
    for i, name in enumerate(inputs):
        payload = Path(name).read_bytes()
        kind = kind_of(payload, name)
        item = pack(payload, kind, more=i < len(inputs) - 1)
        if i < len(inputs) - 1:  # the next picture starts on a 4 KB boundary
            item += b"\xff" * (-len(item) % HEADER_BYTES)
        image += item
        print(f"  {i + 1}. {name}: {'GIF' if kind == 2 else 'JPEG'}, {len(payload)} bytes")
    if len(image) > MEDIA_BYTES:
        sys.exit(f"{len(image)} bytes won't fit in the {MEDIA_BYTES}-byte media partition")
    Path(output).write_bytes(image)
    print(f"Wrote {output} ({len(inputs)} picture{'s' if len(inputs) > 1 else ''}, {len(image)} bytes)")


if __name__ == "__main__":
    main()
