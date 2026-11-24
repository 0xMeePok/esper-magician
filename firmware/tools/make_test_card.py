#!/usr/bin/env python3
"""Draws the default test card for a screen (main/images/<screen>/test-card.png).

    python tools/make_test_card.py               # 2.8-inch, 320x240
    python tools/make_test_card.py --screen 1.9  # 1.9-inch, 170x320

The card has a red, green and blue block and a marked top-left corner, so you
can tell at a glance whether the screen's colours or orientation need the
settings in `idf.py menuconfig` -> "ESPER screen". Turn it into the picture
the firmware shows with tools/img2cyd.py and the same --screen.
"""

import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SCREENS = {"2.8": (320, 240), "1.9": (170, 320)}
IMAGES = Path(__file__).resolve().parent.parent / "main" / "images"
BLOCKS = [("RED", (255, 0, 0)), ("GREEN", (0, 255, 0)), ("BLUE", (0, 0, 255))]


def background(W, H):
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / W + y / H) / 2
            px[x, y] = (int(40 + 90 * t), int(20 + 30 * t), int(90 + 80 * (1 - t)))
    return img


def corner_and_frame(d, W, H, small):
    # Top-left corner marker.
    d.polygon([(0, 0), (34, 0), (0, 34)], fill="white")
    d.text((38, 6), "top left", font=small, fill="white")
    d.text((W // 2, H - 18), f"{W} x {H}", font=small, fill=(200, 200, 220), anchor="mm")
    d.rectangle((0, 0, W - 1, H - 1), outline="white")


def draw_landscape(W, H):
    img = background(W, H)
    d = ImageDraw.Draw(img)
    big = ImageFont.load_default(26)
    mid = ImageFont.load_default(15)
    small = ImageFont.load_default(12)

    d.text((W // 2, 46), "esper-magician", font=big, fill="white", anchor="mm")
    d.text((W // 2, 76), "Hello, Cheap Yellow Display", font=mid, fill=(255, 230, 120), anchor="mm")

    bw, gap, top = 84, 12, 108
    left = (W - (3 * bw + 2 * gap)) // 2
    for i, (name, colour) in enumerate(BLOCKS):
        x0 = left + i * (bw + gap)
        d.rounded_rectangle((x0, top, x0 + bw, top + 60), radius=8, fill=colour)
        d.text((x0 + bw // 2, top + 30), name, font=mid, fill="black" if name == "GREEN" else "white",
               anchor="mm")

    # Greyscale strip, to check contrast and inversion.
    for i in range(16):
        v = i * 17
        d.rectangle((16 + i * 18, 186, 16 + (i + 1) * 18, 202), fill=(v, v, v))

    corner_and_frame(d, W, H, small)
    return img


def draw_portrait(W, H):
    img = background(W, H)
    d = ImageDraw.Draw(img)
    big = ImageFont.load_default(20)
    mid = ImageFont.load_default(14)
    small = ImageFont.load_default(12)

    d.text((W // 2, 58), "esper-magician", font=big, fill="white", anchor="mm")
    d.text((W // 2, 82), "Hello, 1.9-inch screen", font=mid, fill=(255, 230, 120), anchor="mm")

    # The blocks are stacked, because three side by side would be too narrow.
    bh, gap, top, margin = 40, 10, 104, 20
    for i, (name, colour) in enumerate(BLOCKS):
        y0 = top + i * (bh + gap)
        d.rounded_rectangle((margin, y0, W - margin, y0 + bh), radius=8, fill=colour)
        d.text((W // 2, y0 + bh // 2), name, font=mid, fill="black" if name == "GREEN" else "white",
               anchor="mm")

    # Greyscale strip, to check contrast and inversion.
    steps, left = 13, 20
    step_w = (W - 2 * left) // steps
    for i in range(steps):
        v = i * 255 // (steps - 1)
        d.rectangle((left + i * step_w, 264, left + (i + 1) * step_w, 282), fill=(v, v, v))

    corner_and_frame(d, W, H, small)
    return img


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--screen", choices=sorted(SCREENS), default="2.8")
    args = ap.parse_args()

    W, H = SCREENS[args.screen]
    img = draw_landscape(W, H) if W > H else draw_portrait(W, H)
    out = IMAGES / args.screen / "test-card.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print("Wrote", out)


if __name__ == "__main__":
    main()
