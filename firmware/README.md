# Firmware: the ESPER player

This is an [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html)
project for the ESPER screen: a 1.9-inch ST7789 (170×320, portrait) wired to an
ESP32 DevKit 38-pin (ESP32-WROOM-32E, 4 MB flash, CP2102 USB-serial).

It shows the picture or GIF the website sends, and lets the website send a new
one over Wi-Fi:

- The **first time**, the website installs everything over USB, then gives the
  screen your Wi-Fi details with [Improv Serial](https://www.improv-wifi.com/serial/).
- **After that**, the website opens a small page the screen serves on your
  Wi-Fi (`main/receiver.html`) and hands it the picture. The screen saves it to
  its `media` partition and shows it straight away.

Before anything has been sent, or if what's stored is damaged, the screen shows
a colour test card. The button on GPIO 33 switches between the picture and the
test card.

You don't need any of this to use the screen: the website builds nothing and
installs the copy in `public/firmware/esper-1.9/`. This folder is for changing
the player.

## Wiring

Wire with the USB cable unplugged. The screen runs on **3.3 V only**: never
connect its VCC to 5V.

| Screen pin | ESP32 DevKit pin |
| --- | --- |
| SCL | GPIO 18 |
| SDA | GPIO 23 |
| RES | GPIO 4 |
| DC | GPIO 21 |
| CS | GPIO 22 |
| BLK | GPIO 32 |
| VCC | 3V3 |
| GND | GND |

Plus a push button between **GPIO 33** and **GND**. No resistor is needed,
because the firmware turns on the pin's built-in pull-up.

Go by the labels printed on your screen. If its pins are in a different order,
move the wires to match the labels, not the positions. The pins live in
`main/board.h`; if you wire a pin differently, change that line and build again.

## Flash layout (4 MB)

From `partitions.media.csv`, which `src/flashLayout.ts` on the website follows:

| Partition | Offset | Size | Holds |
| --- | --- | --- | --- |
| bootloader | 0x1000 | 26 KB | ESP-IDF bootloader |
| partition table | 0x8000 | 3 KB | |
| nvs | 0x9000 | 28 KB | Wi-Fi details |
| player | 0x10000 | 896 KB | this app (about 772 KB) |
| media | 0xF0000 | 3,136 KB | a 4 KB header, then the JPEG or GIF (up to 3.06 MB) |

The media header is described in `main/media_format.h`; the website writes it
in `src/flash/mediaImage.ts`. The player checks the CRC of the whole picture
before drawing it.

`partitions.factory.csv` is the layout for the website's `VITE_FACTORY_APP`
flag (a 640 KB factory app, ASH-33). It is not used yet.

## How it fits together

```
main/
├── main.c           start-up, the main loop, the GPIO 33 button
├── board.h          pins
├── screen.c         ST7789 set-up and drawing (esp_lcd, double-buffered DMA)
├── media.c          the media partition: check, draw, receive
├── media_format.c   the header and CRC-32 (plain C, tested on a computer)
├── gif_decoder.c    streaming GIF decoder (plain C, tested on a computer)
├── network.c        Wi-Fi station, mDNS name esper-xxxxxx.local, Improv over USB
├── improv.c         Improv Serial (plain C, tested on a computer)
├── web.c            GET /, GET /info, POST /media
├── receiver.html    the page the website opens to hand over a picture
└── test_card.c      the colour test card
```

JPEGs are decoded by the TJpgDec copy in the ESP32's ROM, which reads only
baseline JPEGs; the website always sends baseline. GIFs are decoded row by row
straight to the screen, so no full-frame buffer is needed.

## Build and flash by hand

Open the ESP-IDF terminal (Windows) or run `. $HOME/esp/esp-idf/export.sh`
(macOS/Linux) first, then:

```bash
cd firmware
idf.py set-target esp32      # only the first time
idf.py build
idf.py -p PORT flash monitor
```

`PORT` is the board's serial port, such as `COM5` on Windows,
`/dev/cu.usbserial-0001` on macOS, or `/dev/ttyUSB0` on Linux. If flashing
doesn't start, hold **BOOT**, tap **EN**, release **BOOT**, and try again.

To put a picture on without the website, size it to 170×320 or smaller, save it
as a baseline JPEG or a GIF, then:

```bash
python tools/make_media.py picture.jpg media.bin
python -m esptool --chip esp32 write_flash 0xF0000 media.bin
```

## Update the copy the website installs

After changing the player, rebuild it into the website and commit the result:

```bash
cd firmware
tools/build_web.sh
```

That writes `public/firmware/esper-1.9/` (bootloader, partition table, player
and `manifest.json` with each file's offset, size and SHA-256). The website
refuses to install if a download doesn't match, or if the firmware keeps
pictures somewhere other than where the site writes them.

## Tests

`npm test` at the top of the repo compiles `gif_decoder.c`, `media_format.c`
and `improv.c` with your computer's C compiler (`test/host.c`,
`test/improv_host.c`) and runs them on exactly what the website produces.

## If the picture looks wrong

Press the button on GPIO 33 to see the test card: seven bars (white, yellow,
cyan, green, magenta, red, blue), a grey ramp, a white triangle in the top-left
corner, and a thin white frame round the edge. Then run `idf.py menuconfig`,
open **ESPER screen**, change one setting, and build and flash again.

| What you see | Setting |
| --- | --- |
| Red and blue are swapped | flip **Screen uses BGR colour order** |
| Colours look like a photo negative (white bar looks black) | flip **Invert colours** |
| The corner triangle is top right | flip **Mirror the picture left to right** |
| Picture is upside down | flip both mirror settings |
| Noise, stripes or a garbled picture | lower **SPI clock** to 20 MHz |
| An edge of the white frame is missing, or a stripe of noise down one side | the 35-column offset in `board.h` is wrong for your screen |
| Screen stays dark | check the wiring, especially VCC on 3V3 and BLK on GPIO 32 |

## Not checked on a real board yet

This builds cleanly with ESP-IDF v6.1, and the GIF decoder, media header and
Improv Serial are tested on a computer against what the website sends. It has
not run on hardware. These parts are best guesses until it does:

- **Colour order, invert and the 35-column offset.** RGB with colours inverted
  is what most 1.9-inch IPS ST7789 screens need.
- **JPEG drawing**, which uses the ROM decoder and can't run on a computer.
- **Wi-Fi and the receiving page**, which were tested in Chrome against a
  stand-in for the screen running on a computer.
