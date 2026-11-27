#!/usr/bin/env python3
"""Wraps a JPEG or GIF into a media image, the same way the website does.

    python tools/make_media.py picture.jpg media.bin
    python -m esptool --chip esp32 write_flash 0x1D0000 media.bin

Useful for trying a picture without the website. The file must already be
sized for the screen (170x320 or smaller), and a JPEG must be baseline.
Layout: see main/media_format.h.
"""

import struct
import sys
import zlib
from pathlib import Path

HEADER_BYTES = 4096
SCREEN = (170, 320)


def pack(payload: bytes, kind: int) -> bytes:
    header = b"ESPM" + struct.pack("<HHHHII", 1, kind, SCREEN[0], SCREEN[1], len(payload),
                                   zlib.crc32(payload) & 0xFFFFFFFF)
    return header + b"\xff" * (HEADER_BYTES - len(header)) + payload


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    payload = Path(sys.argv[1]).read_bytes()
    if payload[:6] in (b"GIF87a", b"GIF89a"):
        kind = 2
    elif payload[:2] == b"\xff\xd8":
        kind = 1
    else:
        sys.exit("Expected a JPEG or GIF file")
    Path(sys.argv[2]).write_bytes(pack(payload, kind))
    print(f"Wrote {sys.argv[2]} ({'GIF' if kind == 2 else 'JPEG'}, {len(payload)} bytes)")


if __name__ == "__main__":
    main()
