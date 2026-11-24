#!/usr/bin/env python3
"""Turn a picture or GIF into the file the firmware shows on the screen.

    python tools/img2cyd.py my-photo.jpg                  # 2.8-inch screen
    python tools/img2cyd.py my-animation.gif --screen 1.9 # 1.9-inch screen

The result is written to main/images/<screen>/picture.bin. Build and flash
again to see it. Needs Pillow:  python -m pip install pillow

File layout (header numbers little-endian, pixels RGB565 big-endian):
    "CYD1", width u16, height u16, frame_count u16, reserved u16,
    delay_ms u16 * frame_count, then each frame row by row.
"""

import argparse
import struct
import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps, ImageSequence
except ImportError:
    sys.exit("This tool needs Pillow. Install it with:  python -m pip install pillow")

# Width and height of each screen, as the firmware draws it.
SCREENS = {"2.8": (320, 240), "1.9": (170, 320)}
# The app partition is 0x3F0000 bytes. Leave room for the program itself.
MAX_BYTES = 0x3F0000 - 400 * 1024
IMAGES = Path(__file__).resolve().parent.parent / "main" / "images"


def fit_frame(img, mode, w, h, background):
    img = img.convert("RGBA")
    if mode == "cover":
        img = ImageOps.fit(img, (w, h), Image.LANCZOS)
    elif mode == "stretch":
        img = img.resize((w, h), Image.LANCZOS)
    else:  # contain
        img = ImageOps.contain(img, (w, h), Image.LANCZOS)
    canvas = Image.new("RGBA", (w, h), background)
    canvas.alpha_composite(img, ((w - img.width) // 2, (h - img.height) // 2))
    return canvas.convert("RGB")


def to_rgb565_be(img):
    rgb = img.tobytes()  # R, G, B, R, G, B, ...
    out = bytearray(len(rgb) // 3 * 2)
    for i in range(0, len(rgb), 3):
        v = ((rgb[i] & 0xF8) << 8) | ((rgb[i + 1] & 0xFC) << 3) | (rgb[i + 2] >> 3)
        j = i // 3 * 2
        out[j] = v >> 8
        out[j + 1] = v & 0xFF
    return bytes(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help="PNG, JPG, GIF or anything Pillow can open")
    ap.add_argument("--screen", choices=sorted(SCREENS), default="2.8",
                    help="2.8 for the 320x240 board (default), 1.9 for the 170x320 one")
    ap.add_argument("-o", "--output", type=Path,
                    help="where to write the file (default: main/images/<screen>/picture.bin)")
    ap.add_argument("--fit", choices=["cover", "contain", "stretch"], default="cover",
                    help="cover fills the screen and crops, contain shows it all with borders, "
                         "stretch ignores the shape (default: cover)")
    ap.add_argument("--background", default="black", help="border colour for --fit contain")
    ap.add_argument("--max-frames", type=int, default=0,
                    help="keep at most this many GIF frames by skipping evenly; 0 means all")
    ap.add_argument("--delay", type=int, default=0,
                    help="force every frame to show for this many ms instead of the GIF's timing")
    args = ap.parse_args()
    screen_w, screen_h = SCREENS[args.screen]
    output = args.output or IMAGES / args.screen / "picture.bin"

    src = Image.open(args.input)
    frames, delays = [], []
    for frame in ImageSequence.Iterator(src):
        frames.append(fit_frame(frame.copy(), args.fit, screen_w, screen_h, args.background))
        delays.append(int(frame.info.get("duration", src.info.get("duration", 100)) or 100))

    if args.max_frames and len(frames) > args.max_frames:
        step = len(frames) / args.max_frames
        keep = [int(i * step) for i in range(args.max_frames)]
        # Each kept frame absorbs the time of the frames skipped after it.
        bounds = keep + [len(frames)]
        delays = [sum(delays[bounds[k]:bounds[k + 1]]) for k in range(len(keep))]
        frames = [frames[i] for i in keep]
    if args.delay:
        delays = [args.delay] * len(frames)
    delays = [max(1, min(d, 0xFFFF)) for d in delays]

    data = bytearray(b"CYD1")
    data += struct.pack("<HHHH", screen_w, screen_h, len(frames), 0)
    data += struct.pack("<%dH" % len(delays), *delays)
    for f in frames:
        data += to_rgb565_be(f)

    if len(data) > MAX_BYTES:
        per_frame = screen_w * screen_h * 2
        fit = MAX_BYTES // per_frame
        sys.exit(f"{len(frames)} frames is {len(data) // 1024} KB, too big for the board's flash. "
                 f"About {fit} full-screen frames fit. Try --max-frames {fit}.")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    kind = "picture" if len(frames) == 1 else f"animation, {len(frames)} frames"
    print(f"Wrote {output} ({kind}, {len(data) // 1024} KB). Now build and flash.")


if __name__ == "__main__":
    main()
