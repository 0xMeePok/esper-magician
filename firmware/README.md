# Firmware: the ESPER player

This is an [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/index.html)
project for the ESPER screen: a 1.9-inch ST7789 (170×320, portrait) wired to an
ESP32 DevKit, either the 38-pin one (ESP32-WROOM-32E, CP2102 USB-serial) or the
30-pin USB-C one (ESP32-WROOM, CH340C USB-serial). Both have 4 MB of flash.

The two boards put the screen's backlight (BLK) and the button on different
pins, so each gets its own build. Firmware for the wrong board never switches
the backlight on, and the screen looks dead. The website asks which board you
have before installing, and the screen prints its board in its boot log.

It shows the picture or GIF the website sends, and lets the website send a new
one over Wi-Fi:

- The **first time**, the website installs everything over USB, then gives the
  screen your Wi-Fi details with [Improv Serial](https://www.improv-wifi.com/serial/).
  Or, with no USB: a screen with no Wi-Fi saved (or one it can't reach for a
  while) opens a **setup hotspot** called `ESPER-XXXXXX`, with no password. Join
  it on a phone or computer and a setup page opens (or go to
  `http://192.168.4.1/`); pick your Wi-Fi and type the password. The page then
  links to the website with the screen's address, and the hotspot turns off 90
  seconds later.
- **After that**, the website posts the picture to `POST /media` on your
  Wi-Fi, straight from its own page (`web.c` answers CORS for the website's
  addresses only). Browsers that won't allow that get a small page the screen
  serves (`main/receiver.html`), which the website hands the picture to. The
  screen saves it to its `media` partition and shows it straight away.

Before anything has been sent, or if what's stored is damaged, the screen shows
a colour test card. The button (GPIO 33, or 16 on the 30-pin board) switches between the picture and the
test card. If several pictures are stored one after another (see below), the
button steps through them instead.

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
| BLK | GPIO 32 (38-pin) or GPIO 17 (30-pin) |
| VCC | 3V3 |
| GND | GND |

Plus a push button between **GPIO 33** (38-pin) or **GPIO 16** (30-pin) and
**GND**. No resistor is needed, because the firmware turns on the pin's
built-in pull-up. The 30-pin breadboard wiring is in `wiring-30pin-breadboard.png`
at the top of the repo.

Go by the labels printed on your screen. If its pins are in a different order,
move the wires to match the labels, not the positions. The pins live in
`main/board.h`; if you wire a pin differently, change that line and build again.

## Flash layout (4 MB)

From `partitions.media.csv`, which `src/flashLayout.ts` on the website follows:

| Partition | Offset | Size | Holds |
| --- | --- | --- | --- |
| bootloader | 0x1000 | 26 KB | ESP-IDF bootloader |
| partition table | 0x8000 | 3 KB | |
| nvs | 0x9000 | 20 KB | Wi-Fi details |
| otadata | 0xE000 | 8 KB | which player slot to start |
| ota_0 | 0x10000 | 896 KB | the player (about 850 KB) |
| ota_1 | 0xF0000 | 896 KB | room for the next player version |
| media | 0x1D0000 | 2,240 KB | a 4 KB header, then the JPEG or GIF (up to 2.18 MB) |

There are two player slots so a new version can be written into the spare one
while the current one keeps running. With rollback on
(`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`), a new version that crashes before it
has started Wi-Fi and the web server goes back to the one before. A USB install
always writes slot `ota_0` and resets `otadata`. Installing over Wi-Fi isn't
built yet: it needs signed firmware, so nobody else on the Wi-Fi can install
their own.

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
├── network.c        Wi-Fi station, setup hotspot, mDNS name esper-xxxxxx.local, Improv over USB
├── dns.c            answers every name with the screen while the setup hotspot is on
├── setup.html       the setup hotspot's page: pick a network, type the password
├── improv.c         Improv Serial (plain C, tested on a computer)
├── web.c            GET /, /info, /log; POST /media; setup routes; CORS for the website
├── logbuf.c         keeps the last 8 KB of log for GET /log (reading it over Wi-Fi)
├── receiver.html    the fallback page the website opens to hand over a picture
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
idf.py menuconfig            # ESPER screen -> pick your board (38-pin is the default)
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
python -m esptool --chip esp32 write_flash 0x1D0000 media.bin
```

Give it several pictures to store them all; the button then steps through them
in that order (firmware 1.5.0 and newer; older players show only the first).
Each header except the last says "NEXT" at byte 0x14, and the next picture
starts at the following 4 KB boundary. Sending a picture from the website
replaces the whole set with that one picture.

```bash
python tools/make_media.py koi.gif rain.gif meadow.gif media.bin
```

## Update the copy the website installs

After changing the player, rebuild it into the website and commit the result:

```bash
cd firmware
tools/build_web.sh
# or, without ESP-IDF installed:
docker run --rm -v "$PWD/..":/project -w /project/firmware espressif/idf:v6.1 tools/build_web.sh
```

That builds once per board (`sdkconfig.board.devkit-38` and
`sdkconfig.board.devkit-30` on top of `sdkconfig.defaults`) and writes
`public/firmware/esper-1.9/<board>/`: bootloader, partition table, player and a
`manifest.json` in the ESP Web Tools format (`builds` → `chipFamily` → `parts`),
plus the board and each part's size and SHA-256. The website refuses to install
if a download doesn't match, if the manifest is for another board, or if the
firmware keeps pictures somewhere other than where the site writes them. After
writing, esptool-js checks each part against the MD5 the chip reads back from
its flash.

## Check that an install worked

The screen logs these lines at 115200 baud when it starts. The website shows
them under "Your screen's serial output", or use any serial monitor:

```
I (…) esper: ESPER player 1.1.0 on a 170x320 screen
I (…) esper: board devkit-30: 1.9-inch ST7789 on an ESP32 DevKit 30-pin, BLK GPIO 17, button GPIO 16
I (…) media: JPEG, 23456 bytes, CRC 0x1a2b3c4d OK
I (…) media: drew JPEG 170x320 at (0,0)
I (…) esper: backlight on: showing the picture
```

The website compares the CRC with the one it sent.

Without a USB cable, the website can read the same lines over Wi-Fi ("Show
log over Wi-Fi", and on its own after a Wi-Fi send): `GET /log?since=N`
returns the log written since byte N from the last 8 KB the player keeps,
with `X-Log-Start` (where the text really starts) and `X-Log-Next` (what to
ask for next). It starts once the player is running, so the ROM and
bootloader lines, and anything from before the screen joined the Wi-Fi, are
still only on USB.

## Tests

`npm test` at the top of the repo compiles `gif_decoder.c`, `media_format.c`
and `improv.c` with your computer's C compiler (`test/host.c`,
`test/improv_host.c`) and runs them on exactly what the website produces.

## If the picture looks wrong

Press the button (GPIO 33, or 16 on the 30-pin board) to see the test card: seven bars (white, yellow,
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
