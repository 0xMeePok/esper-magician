#!/usr/bin/env python3
"""Copies a finished build into the website, ready for "Put it on my screen".

    python tools/web_firmware.py build ../public/firmware/esper-1.9

Writes the bootloader, partition table and player, plus manifest.json with
each file's flash offset, size and SHA-256. The website checks every download
against the manifest, and checks that the media partition is where it writes
pictures. Run it through tools/build_web.sh.
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
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build, out = Path(sys.argv[1]), Path(sys.argv[2])
    args = json.loads((build / "flasher_args.json").read_text())
    if args["extra_esptool_args"]["chip"] != "esp32":
        sys.exit("Expected an ESP32 build")

    sdkconfig = (build / "sdkconfig").read_text() if (build / "sdkconfig").exists() else ""
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
        "chip": "ESP32",
        "screen": "1.9",
        "mediaOffset": media_offset(partitions),
        "parts": parts,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total = sum(part["size"] for part in parts)
    print(f"Wrote {out} ({len(parts)} files, {total // 1024} KB, media at 0x{manifest['mediaOffset']:x})")


if __name__ == "__main__":
    main()
