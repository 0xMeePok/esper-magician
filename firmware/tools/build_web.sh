#!/usr/bin/env bash
# Builds the player once per board and puts what the website flashes into
# public/firmware/esper-1.9/<board>/, one manifest per board (like ESPVerse:
# the person picks their board, and gets the build made for its wiring).
# Run from an ESP-IDF terminal (idf.py on the PATH), then commit the result.
set -euo pipefail

firmware="$(cd "$(dirname "$0")/.." && pwd)"
cd "$firmware"
out="$firmware/../public/firmware/esper-1.9"
rm -rf "$out"
for board in devkit-38 devkit-30; do
  build="build-web-$board"
  rm -f "$build/sdkconfig"
  idf.py -B "$build" -D SDKCONFIG="$build/sdkconfig" \
    -D SDKCONFIG_DEFAULTS="sdkconfig.defaults;sdkconfig.board.$board" build
  python3 tools/web_firmware.py "$build" "$out/$board" "$board"
done
