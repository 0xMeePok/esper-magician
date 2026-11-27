#!/usr/bin/env python3
"""Copies a finished build into the website, ready for "Put it on my screen".

    python tools/web_firmware.py build ../public/firmware/esper-1.9/devkit-38 devkit-38

Writes the bootloader, partition table and player, plus manifest.json in the
ESP Web Tools format (builds -> chipFamily -> parts with path and offset), with
each part's size and SHA-256 and the board it was built for. The website checks
every download against the manifest, that the board matches the one picked,
and that the media partition is where it writes pictures. Run it through
tools/build_web.sh.
"""

import csv
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent


def media_offset(partitions_csv: Path) -> int:
    rows = (line for line in partitions_csv.read_text().splitlines() if line.strip() and not line.startswith("#"))
    for row in csv.reader(rows):
        cells = [cell.strip() for cell in row]
        if cells[0] == "media":
            return int(cells[3], 0)
    sys.exit(f"No media partition in {partitions_csv}")


def firmware_version() -> str:
    header = (HERE / "main" / "network.h").read_text()
    match = re.search(r'#define ESPER_FIRMWARE_VERSION "([^"]+)"', header)
    if not match:
        sys.exit("ESPER_FIRMWARE_VERSION not found in main/network.h")
    return match.group(1)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    build, out, board = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    args = json.loads((build / "flasher_args.json").read_text())
    if args["extra_esptool_args"]["chip"] != "esp32":
        sys.exit("Expected an ESP32 build")

    sdkconfig = (build / "sdkconfig").read_text() if (build / "sdkconfig").exists() else ""
    flag = "CONFIG_ESPER_BOARD_" + board.upper().replace("-", "_") + "=y"
    if flag not in sdkconfig:
        sys.exit(f"{build} was not built for {board} (no {flag} in its sdkconfig)")
    table = re.search(r'CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="([^"]+)"', sdkconfig)
    partitions = HERE / (table.group(1) if table else "partitions.media.csv")

    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("*.bin"):
        old.unlink()
    parts = []
    for offset, name in sorted(args["flash_files"].items(), key=lambda item: int(item[0], 16)):
        source = build / name
        target = Path(name).name
        shutil.copyfile(source, out / target)
        data = source.read_bytes()
        parts.append({
            "path": target,
            "offset": int(offset, 16),
            "size": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
        })

    manifest = {
        "name": "ESPER player",
        "version": firmware_version(),
        "screen": "1.9",
        "board": board,
        "mediaOffset": media_offset(partitions),
        "new_install_prompt_erase": False,
        "builds": [{"chipFamily": "ESP32", "parts": parts}],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(part["size"] for part in parts)
    print(f"Wrote {out} for {board} ({len(parts)} files, {total // 1024} KB, media at 0x{manifest['mediaOffset']:x})")


if __name__ == "__main__":
    main()
