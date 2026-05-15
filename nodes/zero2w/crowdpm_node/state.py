from __future__ import annotations

import json
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(slots=True)
class WifiState:
    ssid: str | None = None
    configured_at: str | None = None
    connected_ssid: str | None = None
    last_error: str | None = None


@dataclass(slots=True)
class PairingState:
    phase: str = "unpaired"
    user_code: str | None = None
    device_code: str | None = None
    verification_uri: str | None = None
    verification_uri_complete: str | None = None
    poll_interval: int = 5
    expires_at: str | None = None
    device_id: str | None = None
    started_at: str | None = None
    last_error: str | None = None


@dataclass(slots=True)
class KeyMaterial:
    public_jwk: dict[str, str] | None = None
    private_jwk: dict[str, str] | None = None


@dataclass(slots=True)
class SensorStatus:
    pm25_atm: float | None = None
    temperature_c: float | None = None
    humidity_pct: float | None = None
    lat: float | None = None
    lon: float | None = None
    altitude: float | None = None
    precision: float | None = None
    gps_fix: bool = False
    gps_satellites: int | None = None
    last_error: str | None = None
    last_sample_at: str | None = None


@dataclass(slots=True)
class PortalStatus:
    stage: str = "booting"
    message: str = "Booting"
    setup_ap_ssid: str | None = None
    setup_ap_url: str = "http://10.42.0.1/"
    updated_at: str = field(default_factory=utc_now_iso)


@dataclass(slots=True)
class AppState:
    setup_id_suffix: str = field(default_factory=lambda: secrets.token_hex(2).upper())
    wifi: WifiState = field(default_factory=WifiState)
    pairing: PairingState = field(default_factory=PairingState)
    pairing_key: KeyMaterial = field(default_factory=KeyMaterial)
    ingest_key: KeyMaterial = field(default_factory=KeyMaterial)
    sensors: SensorStatus = field(default_factory=SensorStatus)
    portal: PortalStatus = field(default_factory=PortalStatus)

    @property
    def setup_ap_ssid(self) -> str:
        return f"CrowdPM Setup {self.setup_id_suffix}"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AppState":
        state = cls()
        state.setup_id_suffix = str(data.get("setup_id_suffix") or state.setup_id_suffix)
        state.wifi = WifiState(**{**asdict(state.wifi), **data.get("wifi", {})})
        state.pairing = PairingState(**{**asdict(state.pairing), **data.get("pairing", {})})
        state.pairing_key = KeyMaterial(**{**asdict(state.pairing_key), **data.get("pairing_key", {})})
        state.ingest_key = KeyMaterial(**{**asdict(state.ingest_key), **data.get("ingest_key", {})})
        state.sensors = SensorStatus(**{**asdict(state.sensors), **data.get("sensors", {})})
        state.portal = PortalStatus(**{**asdict(state.portal), **data.get("portal", {})})
        return state


class StateStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> AppState:
        if not self.path.exists():
            return AppState()
        return AppState.from_dict(json.loads(self.path.read_text()))

    def save(self, state: AppState) -> None:
        state.portal.updated_at = utc_now_iso()
        self.path.write_text(json.dumps(state.to_dict(), indent=2, sort_keys=True))
