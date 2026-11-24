#!/usr/bin/env bash
# Builds the player and puts what the website flashes into public/firmware/esper-1.9/.
# Run from an ESP-IDF terminal (idf.py on the PATH), then commit the result.
set -euo pipefail

firmware="$(cd "$(dirname "$0")/.." && pwd)"
cd "$firmware"
idf.py -B build-web -D SDKCONFIG=build-web/sdkconfig build
python3 tools/web_firmware.py build-web "$firmware/../public/firmware/esper-1.9"
