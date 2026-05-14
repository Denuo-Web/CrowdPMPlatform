from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class AppPaths:
    base_dir: Path

    @property
    def state_path(self) -> Path:
        return self.base_dir / "state.json"

    @property
    def db_path(self) -> Path:
        return self.base_dir / "queue.sqlite3"

    @property
    def log_path(self) -> Path:
        return self.base_dir / "node.log"


@dataclass(slots=True)
class AppSettings:
    api_base: str = "https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi"
    ingest_url: str = "https://us-central1-crowdpmplatform.cloudfunctions.net/ingestGateway"
    activation_base_url: str = "https://crowdpmplatform.web.app/activate"
    model: str = "RPI-ZERO2W-PROTOTYPE"
    version: str = "0.1.0"
    pairing_timeout_seconds: int = 15 * 60
    sample_interval_seconds: int = 15
    flush_batch_size: int = 60
    setup_ap_connection_name: str = "crowdpm-setup-ap"
    station_connection_name: str = "crowdpm-station"
    setup_ap_ifname: str = "uap0"
    station_ifname: str = "wlan0"
    setup_ap_subnet: str = "10.42.0.1/24"
    setup_ap_ssid_prefix: str = "CrowdPM Setup"
    setup_http_port: int = 80
    hostname: str = "crowdpm-node"
    gps_device: str = "/dev/serial0"
    pms_device_hint: str = "/dev/serial/by-id"
    dht_gpio_pin: int = 17
    default_poll_interval_seconds: int = 5
    network_check_url: str = "https://crowdpmplatform.web.app/"
