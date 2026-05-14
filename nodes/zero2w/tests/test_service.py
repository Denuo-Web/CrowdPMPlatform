from __future__ import annotations

import sys
import tempfile
import types
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

serial_stub = types.ModuleType("serial")
serial_stub.Serial = object
sys.modules.setdefault("serial", serial_stub)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from crowdpm_node.service import NodeService
from crowdpm_node.settings import AppPaths, AppSettings


PAIRING_KEY = {"kty": "OKP", "crv": "Ed25519", "x": "pair-public"}
PAIRING_PRIVATE = {**PAIRING_KEY, "d": "pair-private"}


class FakePms:
    def __init__(self, pm25_atm: float = 12.5):
        self.pm25_atm = pm25_atm

    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None

    def current(self) -> SimpleNamespace:
        return SimpleNamespace(pm25_atm=self.pm25_atm, last_error=None)


class FakeGps:
    def __init__(self) -> None:
        self.snapshot = SimpleNamespace(
            has_fix=True,
            lat=49.2827,
            lon=-123.1207,
            altitude=12.0,
            precision=4.0,
            satellites=9,
            last_error=None,
        )

    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None

    def current(self) -> SimpleNamespace:
        return self.snapshot


class FakeDht:
    def read(self) -> tuple[float | None, float | None, str | None]:
        return 22.0, 55.0, None


class FakeNetwork:
    def __init__(self, ssid: str | None):
        self.ssid = ssid

    def station_state(self) -> dict[str, str]:
        return {
            "device": "wlan0",
            "type": "wifi",
            "state": "connected" if self.ssid else "disconnected",
            "connection": self.ssid or "",
        }

    def current_station_ssid(self) -> str | None:
        return self.ssid

    def connect_station(self) -> None:
        return None

    def start_setup_ap(self, _ssid: str) -> None:
        return None

    def stop_setup_ap(self) -> None:
        return None

    def system_snapshot(self, *, include_visible_networks: bool = False) -> dict[str, object]:
        return {
            "station": self.station_state(),
            "current_ssid": self.ssid,
            "active_connections": [],
            "visible_networks": [] if include_visible_networks else [],
        }


class FakeApi:
    def __init__(self) -> None:
        self.submitted_batches: list[list[dict[str, object]]] = []

    def mint_access_token(self, **_kwargs) -> dict[str, object]:
        return {"access_token": "token", "expires_in": 600}

    def submit_batch(self, *, points: list[dict[str, object]], **_kwargs) -> dict[str, object]:
        self.submitted_batches.append([dict(point) for point in points])
        return {"accepted": True}


class NodeServiceBatchingTests(unittest.TestCase):
    def make_service(
        self,
        *,
        wifi_ssid: str | None,
        flush_batch_size: int = 60,
        batch_window_seconds: int = 15 * 60,
    ) -> tuple[NodeService, FakeApi, FakeNetwork]:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        settings = AppSettings(
            sample_interval_seconds=0,
            flush_batch_size=flush_batch_size,
            batch_window_seconds=batch_window_seconds,
        )
        paths = AppPaths(base_dir=Path(temp_dir.name))
        with mock.patch("crowdpm_node.service.generate_keypair", return_value=(PAIRING_KEY, PAIRING_PRIVATE)):
            service = NodeService(settings=settings, paths=paths)
        api = FakeApi()
        network = FakeNetwork(wifi_ssid)
        service.api = api
        service.network = network
        service.pms = FakePms()
        service.gps = FakeGps()
        service.dht = FakeDht()
        service.state.pairing.device_id = "device-123"
        service.state.pairing.phase = "paired"
        service.state.wifi.ssid = "Home WiFi"
        return service, api, network

    def age_open_batch(self, service: NodeService, created_at: str) -> None:
        with closing(service.queue._connect()) as conn:
            conn.execute(
                "UPDATE measurements SET created_at = ? WHERE uploaded_at IS NULL",
                (created_at,),
            )
            conn.commit()

    def test_online_batch_waits_for_time_window_before_upload(self) -> None:
        service, api, _network = self.make_service(wifi_ssid="Home WiFi", batch_window_seconds=300)

        service._tick()
        self.assertEqual(len(api.submitted_batches), 0)
        self.assertEqual(service.queue.pending_count(), 1)

        self.age_open_batch(service, "2020-01-01T00:00:00Z")
        service._tick()

        self.assertEqual(len(api.submitted_batches), 1)
        self.assertEqual(len(api.submitted_batches[0]), 1)
        self.assertEqual(service.queue.pending_count(), 1)
        self.assertEqual(service.public_status()["queue"]["open_batch"]["point_count"], 1)

    def test_wifi_reconnect_closes_offline_batch_and_starts_new_one(self) -> None:
        service, api, network = self.make_service(wifi_ssid=None, flush_batch_size=10, batch_window_seconds=3600)

        service._tick()
        service._tick()
        self.assertEqual(len(api.submitted_batches), 0)
        self.assertEqual(service.queue.pending_count(), 2)

        network.ssid = "Home WiFi"
        service._tick()

        self.assertEqual(len(api.submitted_batches), 1)
        self.assertEqual(len(api.submitted_batches[0]), 2)
        self.assertEqual(service.queue.pending_count(), 1)
        self.assertEqual(service.public_status()["queue"]["closed_batch_count"], 0)
        self.assertEqual(service.public_status()["queue"]["open_batch"]["point_count"], 1)

    def test_online_batch_closes_at_point_limit(self) -> None:
        service, api, _network = self.make_service(wifi_ssid="Home WiFi", flush_batch_size=3, batch_window_seconds=3600)

        service._tick()
        service._tick()
        self.assertEqual(len(api.submitted_batches), 0)

        service._tick()

        self.assertEqual(len(api.submitted_batches), 1)
        self.assertEqual(len(api.submitted_batches[0]), 3)
        self.assertEqual(service.queue.pending_count(), 0)


if __name__ == "__main__":
    unittest.main()
