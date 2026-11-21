#!/usr/bin/env python3
"""Draws the default test card (main/images/test-card.png).

The card has a red, green and blue block and a marked top-left corner, so you
can tell at a glance whether the screen's colours or orientation need the
settings in `idf.py menuconfig` -> "Cheap Yellow Display".
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 320, 240
out = Path(__file__).resolve().parent.parent / "main" / "images" / "test-card.png"

img = Image.new("RGB", (W, H))
px = img.load()
for y in range(H):
    for x in range(W):
        t = (x / W + y / H) / 2
        px[x, y] = (int(40 + 90 * t), int(20 + 30 * t), int(90 + 80 * (1 - t)))

d = ImageDraw.Draw(img)
big = ImageFont.load_default(26)
mid = ImageFont.load_default(15)
small = ImageFont.load_default(12)

d.text((W // 2, 46), "esper-magician", font=big, fill="white", anchor="mm")
d.text((W // 2, 76), "Hello, Cheap Yellow Display", font=mid, fill=(255, 230, 120), anchor="mm")

blocks = [("RED", (255, 0, 0)), ("GREEN", (0, 255, 0)), ("BLUE", (0, 0, 255))]
bw, gap, top = 84, 12, 108
left = (W - (3 * bw + 2 * gap)) // 2
for i, (name, colour) in enumerate(blocks):
    x0 = left + i * (bw + gap)
    d.rounded_rectangle((x0, top, x0 + bw, top + 60), radius=8, fill=colour)
    d.text((x0 + bw // 2, top + 30), name, font=mid, fill="black" if name == "GREEN" else "white",
           anchor="mm")

# Greyscale strip, to check contrast and inversion.
for i in range(16):
    v = i * 17
    d.rectangle((16 + i * 18, 186, 16 + (i + 1) * 18, 202), fill=(v, v, v))

# Top-left corner marker.
d.polygon([(0, 0), (34, 0), (0, 34)], fill="white")
d.text((38, 6), "top left", font=small, fill="white")

d.text((W // 2, 222), "320 x 240", font=small, fill=(200, 200, 220), anchor="mm")
d.rectangle((0, 0, W - 1, H - 1), outline="white")

img.save(out)
print("Wrote", out)
