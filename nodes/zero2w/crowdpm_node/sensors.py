from __future__ import annotations

import glob
import os
import threading
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import serial


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def _convert_nmea_coord(raw_value: str, hemisphere: str) -> float | None:
    if not raw_value or not hemisphere:
        return None
    try:
        if hemisphere in {"N", "S"}:
            degrees = int(raw_value[:2])
            minutes = float(raw_value[2:])
        else:
            degrees = int(raw_value[:3])
            minutes = float(raw_value[3:])
    except ValueError:
        return None
    value = degrees + minutes / 60.0
    if hemisphere in {"S", "W"}:
        value *= -1
    return value


@dataclass(slots=True)
class PmsSnapshot:
    pm25_atm: float | None = None
    raw_frame_hex: str | None = None
    last_update: str | None = None
    last_error: str | None = None


class PmsReader(threading.Thread):
    def __init__(self, device_hint_dir: str):
        super().__init__(daemon=True)
        self.device_hint_dir = device_hint_dir
        self.snapshot = PmsSnapshot()
        self._lock = threading.Lock()
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def current(self) -> PmsSnapshot:
        with self._lock:
            return PmsSnapshot(**asdict(self.snapshot))

    def _device_path(self) -> str | None:
        candidates = sorted(glob.glob(os.path.join(self.device_hint_dir, "*")))
        if candidates:
            return candidates[0]
        return "/dev/ttyUSB0" if os.path.exists("/dev/ttyUSB0") else None

    def _update(self, **changes: Any) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(self.snapshot, key, value)

    def _parse_frame(self, frame: bytes) -> float | None:
        if len(frame) < 32 or frame[:2] != b"\x42\x4d":
            return None
        return float(int.from_bytes(frame[12:14], "big"))

    def run(self) -> None:
        while not self._stop.is_set():
            device = self._device_path()
            if not device:
                self._update(last_error="PMS device missing")
                time.sleep(5)
                continue
            try:
                with serial.Serial(device, 9600, timeout=2) as ser:
                    while not self._stop.is_set():
                        data = ser.read(64)
                        if not data:
                            continue
                        start = data.find(b"\x42\x4d")
                        if start < 0 or len(data) < start + 32:
                            continue
                        frame = data[start:start + 32]
                        pm25 = self._parse_frame(frame)
                        if pm25 is None:
                            continue
                        self._update(
                            pm25_atm=pm25,
                            raw_frame_hex=frame.hex(),
                            last_update=utc_now_iso(),
                            last_error=None,
                        )
            except Exception as exc:
                self._update(last_error=f"PMS read failed: {exc}")
                time.sleep(3)


@dataclass(slots=True)
class GpsSnapshot:
    has_fix: bool = False
    lat: float | None = None
    lon: float | None = None
    altitude: float | None = None
    precision: float | None = None
    satellites: int | None = None
    last_sentence: str | None = None
    last_update: str | None = None
    last_error: str | None = None


class GpsReader(threading.Thread):
    def __init__(self, device: str):
        super().__init__(daemon=True)
        self.device = device
        self.snapshot = GpsSnapshot()
        self._lock = threading.Lock()
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def current(self) -> GpsSnapshot:
        with self._lock:
            return GpsSnapshot(**asdict(self.snapshot))

    def _update(self, **changes: Any) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(self.snapshot, key, value)

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                with serial.Serial(self.device, 9600, timeout=2) as ser:
                    while not self._stop.is_set():
                        line = ser.readline().decode("ascii", "replace").strip()
                        if not line.startswith("$"):
                            continue
                        self._handle_sentence(line)
            except Exception as exc:
                self._update(last_error=f"GPS read failed: {exc}")
                time.sleep(3)

    def _handle_sentence(self, line: str) -> None:
        parts = line.split(",")
        sentence = parts[0]
        changes: dict[str, Any] = {"last_sentence": line, "last_update": utc_now_iso(), "last_error": None}
        if sentence.endswith("GGA") and len(parts) >= 10:
            lat = _convert_nmea_coord(parts[2], parts[3])
            lon = _convert_nmea_coord(parts[4], parts[5])
            fix_quality = int(parts[6] or "0")
            satellites = int(parts[7] or "0")
            precision = float(parts[8]) if parts[8] else None
            altitude = float(parts[9]) if parts[9] else None
            changes.update(
                has_fix=fix_quality > 0 and lat is not None and lon is not None,
                lat=lat,
                lon=lon,
                altitude=altitude,
                precision=precision,
                satellites=satellites,
            )
        elif sentence.endswith("RMC") and len(parts) >= 7:
            status = parts[2]
            lat = _convert_nmea_coord(parts[3], parts[4])
            lon = _convert_nmea_coord(parts[5], parts[6])
            if status == "A" and lat is not None and lon is not None:
                changes.update(has_fix=True, lat=lat, lon=lon)
        self._update(**changes)


class DhtReader:
    def __init__(self, gpio_pin: int):
        self.gpio_pin = gpio_pin

    def read(self) -> tuple[float | None, float | None, str | None]:
        try:
            import board
            import adafruit_dht
        except Exception as exc:
            return None, None, f"DHT imports unavailable: {exc}"

        sensor = adafruit_dht.DHT22(getattr(board, f"D{self.gpio_pin}"), use_pulseio=False)
        try:
            try:
                return sensor.temperature, sensor.humidity, None
            except RuntimeError as exc:
                return None, None, str(exc)
        finally:
            sensor.exit()
