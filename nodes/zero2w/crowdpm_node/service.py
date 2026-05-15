from __future__ import annotations

import logging
import threading
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from typing import Any

from .api import CrowdPmApiClient, CrowdPmApiError
from .db import QueueDb
from .dpop import generate_keypair
from .network import NetworkManager, NetworkError
from .settings import AppPaths, AppSettings
from .state import AppState, StateStore, utc_now_iso
from .sensors import DhtReader, GpsReader, PmsReader


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def normalize_utc_timestamp(value: str | None) -> str | None:
    if not value:
        return value
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        if value.endswith("Z"):
            try:
                parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            except ValueError:
                return value
        else:
            return value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    if value.endswith("Z"):
        try:
            return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class NodeService:
    def __init__(self, *, settings: AppSettings, paths: AppPaths):
        self.settings = settings
        self.paths = paths
        self.paths.base_dir.mkdir(parents=True, exist_ok=True)
        logging.basicConfig(
            filename=self.paths.log_path,
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
        )
        self.logger = logging.getLogger("crowdpm-node")
        self.state_store = StateStore(self.paths.state_path)
        self.state = self.state_store.load()
        self.queue = QueueDb(self.paths.db_path)
        self.network = NetworkManager(self.settings)
        self.api = CrowdPmApiClient(self.settings.api_base, self.settings.ingest_url)
        self.pms = PmsReader(self.settings.pms_device_hint)
        self.gps = GpsReader(self.settings.gps_device)
        self.dht = DhtReader(self.settings.dht_gpio_pin)
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self._worker = threading.Thread(target=self._run_loop, daemon=True)
        self._last_sample_at = 0.0
        self._access_token: str | None = None
        self._access_token_expires_at: datetime | None = None
        self._last_station_attempt = 0.0
        self._last_pair_poll_at = 0.0
        self._ensure_keys()
        self._set_portal_stage("booting", "Booting node services.")

    def log(self, component: str, message: str) -> None:
        self.logger.info("[%s] %s", component, message)

    def _ensure_keys(self) -> None:
        changed = False
        if not self.state.pairing_key.private_jwk or not self.state.pairing_key.public_jwk:
            public, private = generate_keypair()
            self.state.pairing_key.public_jwk = public
            self.state.pairing_key.private_jwk = private
            changed = True
        if not self.state.ingest_key.private_jwk or not self.state.ingest_key.public_jwk:
            public, private = generate_keypair()
            self.state.ingest_key.public_jwk = public
            self.state.ingest_key.private_jwk = private
            changed = True
        if changed:
            self._persist_state()

    def start(self) -> None:
        self.pms.start()
        self.gps.start()
        self._worker.start()

    def stop(self) -> None:
        self._stop.set()
        self.pms.stop()
        self.gps.stop()
        self._worker.join(timeout=5)

    def public_status(self, *, include_visible_networks: bool = False) -> dict[str, Any]:
        with self._lock:
            return {
                "portal": asdict(self.state.portal),
                "wifi": asdict(self.state.wifi),
                "pairing": asdict(self.state.pairing),
                "sensors": asdict(self.state.sensors),
                "network": self.network.system_snapshot(include_visible_networks=include_visible_networks),
                "queue": self.queue.status_summary(),
            }

    def configure_wifi(self, ssid: str, password: str) -> None:
        with self._lock:
            self.state.wifi.ssid = ssid
            self.state.wifi.configured_at = utc_now_iso()
            self.state.wifi.last_error = None
            self._set_portal_stage("connecting_wifi", f"Saved Wi-Fi for {ssid}. Trying to connect.")
            self._persist_state()
        try:
            self.network.configure_station(ssid, password or None)
            self.network.connect_station()
        except Exception as exc:
            with self._lock:
                self.state.wifi.last_error = str(exc)
                self._set_portal_stage("wifi_error", f"Wi-Fi connect failed: {exc}")
                self._persist_state()

    def _persist_state(self) -> None:
        self.state_store.save(self.state)

    def _set_portal_stage(self, stage: str, message: str) -> None:
        self.state.portal.stage = stage
        self.state.portal.message = message
        self.state.portal.setup_ap_ssid = self.state.setup_ap_ssid

    def _run_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception as exc:  # pragma: no cover - best effort on-device loop
                self.log("loop", f"tick failure: {exc}")
                with self._lock:
                    self.state.portal.message = f"Internal error: {exc}"
                    self.state.sensors.last_error = str(exc)
                    self._persist_state()
            time.sleep(2)

    def _tick(self) -> None:
        with self._lock:
            self._sync_sensor_status()
            station = self.network.station_state()
            previous_ssid = self.state.wifi.connected_ssid
            self.state.wifi.connected_ssid = self.network.current_station_ssid()
            self._handle_wifi_transition(previous_ssid, self.state.wifi.connected_ssid)
            if self.state.wifi.connected_ssid:
                self.state.wifi.last_error = None
            elif station["state"].lower() not in {"connected"} and self.state.wifi.ssid and time.time() - self._last_station_attempt > 20:
                self._last_station_attempt = time.time()
                try:
                    self.network.connect_station()
                except Exception as exc:
                    self.state.wifi.last_error = str(exc)

            if not self.state.wifi.ssid:
                self._ensure_setup_ap()
                self._set_portal_stage("awaiting_wifi", "Connect to this setup network and enter the home Wi-Fi password.")
            elif self.state.pairing.device_id:
                self._set_portal_stage("paired", "Node is paired. It will upload queued batches when this Wi-Fi is reachable again.")
                self._ensure_station_only()
            else:
                self._ensure_setup_ap()
                if self.state.wifi.connected_ssid:
                    if self.state.pairing.last_error:
                        self._set_portal_stage("pairing_error", f"Pairing backend error: {self.state.pairing.last_error}")
                    elif self.state.pairing.user_code:
                        self._set_portal_stage("awaiting_approval", f"Approve the node with code {self.state.pairing.user_code}.")
                    else:
                        self._set_portal_stage("pairing", "Wi-Fi is up. Starting CrowdPM pairing.")
                    self._advance_pairing()
                else:
                    self._set_portal_stage("connecting_wifi", f"Trying to join {self.state.wifi.ssid}.")

            self._maybe_finalize_open_batch()
            self._maybe_queue_sample()
            self._maybe_finalize_open_batch()
            self._maybe_flush_queue()
            self._persist_state()

    def _handle_wifi_transition(self, previous_ssid: str | None, current_ssid: str | None) -> None:
        if previous_ssid == current_ssid:
            return
        if not previous_ssid and not current_ssid:
            return
        self._close_open_batches(f"wifi_transition:{previous_ssid or 'offline'}->{current_ssid or 'offline'}")
        self._access_token = None
        self._access_token_expires_at = None

    def _ensure_setup_ap(self) -> None:
        try:
            self.network.start_setup_ap(self.state.setup_ap_ssid)
        except NetworkError as exc:
            self.state.portal.message = f"Setup AP failed: {exc}"

    def _ensure_station_only(self) -> None:
        try:
            self.network.stop_setup_ap()
        except NetworkError:
            pass

    def _sync_sensor_status(self) -> None:
        pms = self.pms.current()
        gps = self.gps.current()
        self.state.sensors.pm25_atm = pms.pm25_atm
        self.state.sensors.gps_fix = gps.has_fix
        self.state.sensors.lat = gps.lat
        self.state.sensors.lon = gps.lon
        self.state.sensors.altitude = gps.altitude
        self.state.sensors.precision = gps.precision
        self.state.sensors.gps_satellites = gps.satellites
        self.state.sensors.last_sample_at = utc_now_iso()
        errors = [message for message in (pms.last_error, gps.last_error) if message]
        self.state.sensors.last_error = "; ".join(errors) if errors else None

    def _close_open_batches(self, reason: str) -> None:
        closed_points = self.queue.close_open_batches()
        if closed_points:
            self.log(
                "queue",
                f"closed local batch reason={reason} points={closed_points} uploadable={self.queue.pending_closed_batch_count()}",
            )

    def _maybe_finalize_open_batch(self) -> None:
        open_batch = self.queue.current_open_batch()
        if not open_batch:
            return
        if open_batch.point_count >= self.settings.flush_batch_size:
            self._close_open_batches(f"point_limit:{open_batch.point_count}")
            return
        started_at = parse_utc_timestamp(open_batch.started_at)
        if not started_at:
            return
        if utcnow() - started_at >= timedelta(seconds=self.settings.batch_window_seconds):
            self._close_open_batches(f"time_window:{self.settings.batch_window_seconds}s")

    def _advance_pairing(self) -> None:
        pairing = self.state.pairing
        public_key_b64url = self.state.pairing_key.public_jwk["x"]
        now = utcnow()
        expires_at = datetime.fromisoformat(pairing.expires_at) if pairing.expires_at else None

        if not pairing.device_code or not expires_at or now >= expires_at:
            session = self.api.start_pairing(
                public_key_b64url=public_key_b64url,
                model=self.settings.model,
                version=self.settings.version,
                nonce=self.state.setup_id_suffix,
            )
            pairing.phase = "awaiting_approval"
            pairing.user_code = session.user_code
            pairing.device_code = session.device_code
            pairing.verification_uri = session.verification_uri
            pairing.verification_uri_complete = session.verification_uri_complete
            pairing.poll_interval = session.poll_interval
            pairing.expires_at = (now + timedelta(seconds=session.expires_in)).isoformat()
            pairing.started_at = utc_now_iso()
            pairing.last_error = None
            self._last_pair_poll_at = 0.0
            self._set_portal_stage("awaiting_approval", f"Approve the node with code {session.user_code}.")
            return

        if pairing.phase in {"awaiting_approval", "authorized"} and pairing.device_code:
            if time.time() - self._last_pair_poll_at < pairing.poll_interval:
                return
            self._last_pair_poll_at = time.time()
            try:
                token_payload = self.api.poll_registration_token(
                    device_code=pairing.device_code,
                    pairing_private_jwk=self.state.pairing_key.private_jwk,
                    pairing_public_jwk=self.state.pairing_key.public_jwk,
                )
            except CrowdPmApiError as exc:
                if exc.error_code == "authorization_pending":
                    pairing.last_error = None
                    return
                if exc.error_code == "slow_down":
                    next_interval = int(exc.payload.get("poll_interval", pairing.poll_interval)) if isinstance(exc.payload, dict) else pairing.poll_interval + 2
                    pairing.poll_interval = max(pairing.poll_interval, next_interval)
                    return
                if exc.error_code == "expired_token":
                    pairing.device_code = None
                    pairing.user_code = None
                    pairing.verification_uri = None
                    pairing.verification_uri_complete = None
                    pairing.expires_at = None
                    pairing.phase = "unpaired"
                    pairing.last_error = "Pairing expired. Starting a fresh session."
                    self._last_pair_poll_at = 0.0
                    self._set_portal_stage("pairing_expired", pairing.last_error)
                    return
                pairing.last_error = str(exc)
                self._set_portal_stage("pairing_error", f"Pairing backend error: {exc}")
                return
            except Exception as exc:
                pairing.last_error = str(exc)
                self._set_portal_stage("pairing_error", f"Pairing backend error: {exc}")
                return

            try:
                registration_token = token_payload["registration_token"]
                pairing.phase = "authorized"
                registration = self.api.register_device(
                    registration_token=registration_token,
                    pairing_private_jwk=self.state.pairing_key.private_jwk,
                    pairing_public_jwk=self.state.pairing_key.public_jwk,
                    ingest_public_jwk=self.state.ingest_key.public_jwk,
                )
                pairing.device_id = registration["device_id"]
                pairing.phase = "paired"
                pairing.last_error = None
                self._set_portal_stage("paired", f"Device registered as {pairing.device_id}.")
            except Exception as exc:
                pairing.last_error = str(exc)
                self._set_portal_stage("pairing_error", f"Pairing backend error: {exc}")

    def _maybe_queue_sample(self) -> None:
        if time.time() - self._last_sample_at < self.settings.sample_interval_seconds:
            return
        self._last_sample_at = time.time()
        temperature_c, humidity_pct, dht_error = self.dht.read()
        if dht_error:
            self.state.sensors.last_error = dht_error
        else:
            self.state.sensors.temperature_c = temperature_c
            self.state.sensors.humidity_pct = humidity_pct

        if self.state.sensors.pm25_atm is None:
            return
        if not self.state.sensors.gps_fix or self.state.sensors.lat is None or self.state.sensors.lon is None:
            return
        point = {
            "pollutant": "pm25",
            "value": self.state.sensors.pm25_atm,
            "unit": "µg/m³",
            "lat": self.state.sensors.lat,
            "lon": self.state.sensors.lon,
            "timestamp": utc_now_iso(),
            "flags": 0,
        }
        if self.state.sensors.altitude is not None:
            point["altitude"] = self.state.sensors.altitude
        if self.state.sensors.precision is not None:
            point["precision"] = self.state.sensors.precision
        open_batch = self.queue.current_open_batch()
        batch_id = open_batch.batch_id if open_batch else self.queue.next_batch_id()
        self.queue.enqueue_point(point, temperature_c, humidity_pct, batch_id=batch_id)
        current_batch = self.queue.current_open_batch()
        open_points = current_batch.point_count if current_batch else 0
        self.log("queue", f"queued point pending={self.queue.pending_count()} open_batch_points={open_points}")

    def _maybe_flush_queue(self) -> None:
        if not self.state.pairing.device_id or not self.state.wifi.connected_ssid:
            return
        pending = self.queue.oldest_pending(self.settings.flush_batch_size)
        if not pending:
            return

        now = utcnow()
        if not self._access_token or not self._access_token_expires_at or now >= self._access_token_expires_at:
            try:
                token = self.api.mint_access_token(
                    device_id=self.state.pairing.device_id,
                    ingest_private_jwk=self.state.ingest_key.private_jwk,
                    ingest_public_jwk=self.state.ingest_key.public_jwk,
                )
                self._access_token = token["access_token"]
                self._access_token_expires_at = now + timedelta(seconds=int(token.get("expires_in", 600)) - 30)
            except Exception as exc:
                self.state.pairing.last_error = f"Access token failed: {exc}"
                return

        try:
            points = []
            ids = []
            for row in pending:
                point = dict(row.point)
                point["timestamp"] = normalize_utc_timestamp(point.get("timestamp"))
                for optional_key in ("altitude", "precision", "flags"):
                    if point.get(optional_key) is None:
                        point.pop(optional_key, None)
                point["device_id"] = self.state.pairing.device_id
                points.append(point)
                ids.append(row.id)
            self.api.submit_batch(
                device_id=self.state.pairing.device_id,
                access_token=self._access_token,
                ingest_private_jwk=self.state.ingest_key.private_jwk,
                ingest_public_jwk=self.state.ingest_key.public_jwk,
                points=points,
            )
            self.queue.mark_uploaded(ids)
            self.state.pairing.last_error = None
            self.log(
                "ingest",
                f"uploaded batch local_batch={pending[0].batch_id} size={len(points)} pending={self.queue.pending_count()}",
            )
        except Exception as exc:
            self.queue.mark_error([row.id for row in pending], str(exc))
            self.state.pairing.last_error = f"Ingest failed: {exc}"
