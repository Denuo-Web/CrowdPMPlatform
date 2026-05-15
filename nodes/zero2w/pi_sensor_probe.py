#!/usr/bin/env python3

import argparse
import glob
import os
import sys
import time
from typing import Iterable


def detect_pms_port() -> str | None:
    by_id = sorted(glob.glob("/dev/serial/by-id/*"))
    if by_id:
        return by_id[0]
    if os.path.exists("/dev/ttyUSB0"):
        return "/dev/ttyUSB0"
    return None


def probe_gps(device: str, seconds: int) -> int:
    import serial

    print(f"[gps] reading {device} for {seconds}s")
    with serial.Serial(device, 9600, timeout=1) as ser:
        end = time.time() + seconds
        seen = 0
        while time.time() < end:
            line = ser.readline().decode("ascii", "replace").strip()
            if not line:
                continue
            print(line)
            seen += 1
            if seen >= 12:
                break
    if seen == 0:
        print("[gps] no NMEA lines received")
        return 1
    return 0


def parse_pms_frame(frame: bytes) -> dict[str, int]:
    if len(frame) < 32 or frame[0:2] != b"\x42\x4d":
        raise ValueError("not a PMS5003 frame")
    return {
        "pm1_0_cf1": int.from_bytes(frame[4:6], "big"),
        "pm2_5_cf1": int.from_bytes(frame[6:8], "big"),
        "pm10_cf1": int.from_bytes(frame[8:10], "big"),
        "pm1_0_atm": int.from_bytes(frame[10:12], "big"),
        "pm2_5_atm": int.from_bytes(frame[12:14], "big"),
        "pm10_atm": int.from_bytes(frame[14:16], "big"),
        "particles_0_3um": int.from_bytes(frame[16:18], "big"),
        "particles_0_5um": int.from_bytes(frame[18:20], "big"),
        "particles_1_0um": int.from_bytes(frame[20:22], "big"),
        "particles_2_5um": int.from_bytes(frame[22:24], "big"),
        "particles_5_0um": int.from_bytes(frame[24:26], "big"),
        "particles_10um": int.from_bytes(frame[26:28], "big"),
    }


def find_pms_frame(data: bytes) -> bytes | None:
    for index in range(0, max(0, len(data) - 31)):
        if data[index:index + 2] == b"\x42\x4d":
            return data[index:index + 32]
    return None


def probe_pms(device: str, seconds: int) -> int:
    import serial

    print(f"[pms] reading {device} for {seconds}s")
    with serial.Serial(device, 9600, timeout=1) as ser:
        end = time.time() + seconds
        chunks: list[bytes] = []
        while time.time() < end:
            data = ser.read(256)
            if data:
                chunks.append(data)
    raw = b"".join(chunks)
    print(f"[pms] bytes={len(raw)}")
    if not raw:
        print("[pms] no bytes received")
        return 1
    frame = find_pms_frame(raw)
    if frame is None:
        print(f"[pms] first_bytes={raw[:64].hex()}")
        print("[pms] no 42 4d frame header found")
        return 1
    parsed = parse_pms_frame(frame)
    for key, value in parsed.items():
        print(f"{key}={value}")
    return 0


def probe_dht(gpio_pins: Iterable[int], samples: int) -> int:
    import adafruit_dht
    import board

    overall_rc = 1
    for pin in gpio_pins:
        board_name = f"D{pin}"
        print(f"[dht] probing GPIO{pin} ({board_name})")
        try:
            board_pin = getattr(board, board_name)
        except AttributeError:
            print(f"[dht] board.{board_name} is not available")
            continue

        sensor = adafruit_dht.DHT22(board_pin, use_pulseio=False)
        pin_success = False
        try:
            for sample_index in range(samples):
                try:
                    temperature = sensor.temperature
                    humidity = sensor.humidity
                    print(
                        f"sample {sample_index + 1}: "
                        f"temperature_c={temperature} humidity_pct={humidity}"
                    )
                    pin_success = True
                    overall_rc = 0
                    break
                except RuntimeError as exc:
                    print(f"sample {sample_index + 1}: retry {exc}")
                    time.sleep(2)
        finally:
            sensor.exit()

        if pin_success:
            break
    return overall_rc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gps-device", default="/dev/serial0")
    parser.add_argument("--gps-seconds", type=int, default=10)
    parser.add_argument("--pms-device", default=None)
    parser.add_argument("--pms-seconds", type=int, default=10)
    parser.add_argument("--dht-pins", default="17")
    parser.add_argument("--dht-samples", type=int, default=10)
    args = parser.parse_args()

    rc = 0

    if os.path.exists(args.gps_device):
        rc |= probe_gps(args.gps_device, args.gps_seconds)
    else:
        print(f"[gps] device missing: {args.gps_device}")
        rc |= 1

    pms_device = args.pms_device or detect_pms_port()
    if pms_device and os.path.exists(pms_device):
        rc |= probe_pms(pms_device, args.pms_seconds)
    else:
        print("[pms] serial device missing")
        rc |= 1

    dht_pins = [int(pin.strip()) for pin in args.dht_pins.split(",") if pin.strip()]
    rc |= probe_dht(dht_pins, args.dht_samples)

    return rc


if __name__ == "__main__":
    sys.exit(main())
