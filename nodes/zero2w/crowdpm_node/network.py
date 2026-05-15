from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import asdict, dataclass

from .settings import AppSettings


class NetworkError(RuntimeError):
    pass


@dataclass(slots=True)
class WifiNetwork:
    ssid: str
    signal: int | None
    security: str


class NetworkManager:
    def __init__(self, settings: AppSettings):
        self.settings = settings
        self._iw_binary = shutil.which("iw") or "/sbin/iw"

    def _run(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        proc = subprocess.run(args, capture_output=True, text=True)
        if check and proc.returncode != 0:
            raise NetworkError(f"{' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}")
        return proc

    def _split_fields(self, line: str) -> list[str]:
        fields: list[str] = []
        current: list[str] = []
        escaped = False
        for char in line:
            if escaped:
                current.append(char)
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if char == ":":
                fields.append("".join(current))
                current = []
                continue
            current.append(char)
        fields.append("".join(current))
        return fields

    def ensure_ap_interface(self) -> None:
        proc = self._run("ip", "-brief", "link", "show", self.settings.setup_ap_ifname, check=False)
        if proc.returncode == 0:
            return
        self._run(self._iw_binary, "dev", self.settings.station_ifname, "interface", "add", self.settings.setup_ap_ifname, "type", "__ap")

    def _connection_exists(self, name: str) -> bool:
        proc = self._run(
            "nmcli",
            "--terse",
            "--fields",
            "NAME",
            "connection",
            "show",
            check=False,
        )
        if proc.returncode != 0:
            return False
        return any(line.strip() == name for line in proc.stdout.splitlines())

    def ensure_setup_ap_profile(self, ssid: str) -> None:
        if not self._connection_exists(self.settings.setup_ap_connection_name):
            self._run(
                "nmcli", "connection", "add",
                "type", "wifi",
                "ifname", self.settings.setup_ap_ifname,
                "con-name", self.settings.setup_ap_connection_name,
                "ssid", ssid,
            )
        self._run(
            "nmcli", "connection", "modify", self.settings.setup_ap_connection_name,
            "802-11-wireless.mode", "ap",
            "802-11-wireless.band", "bg",
            "ipv4.method", "shared",
            "ipv4.addresses", self.settings.setup_ap_subnet,
            "ipv6.method", "disabled",
            "connection.autoconnect", "no",
        )

    def start_setup_ap(self, ssid: str) -> None:
        self.ensure_ap_interface()
        self.ensure_setup_ap_profile(ssid)
        self._run("nmcli", "connection", "up", self.settings.setup_ap_connection_name)

    def stop_setup_ap(self) -> None:
        self._run("nmcli", "connection", "down", self.settings.setup_ap_connection_name, check=False)
        self._run("nmcli", "device", "disconnect", self.settings.setup_ap_ifname, check=False)
        self._run("ip", "link", "delete", self.settings.setup_ap_ifname, check=False)

    def scan_wifi(self) -> list[WifiNetwork]:
        proc = self._run(
            "nmcli", "--terse",
            "--fields", "SSID,SIGNAL,SECURITY", "device", "wifi", "list",
            "ifname", self.settings.station_ifname, "--rescan", "yes",
        )
        seen: dict[str, WifiNetwork] = {}
        for line in proc.stdout.splitlines():
            if not line.strip():
                continue
            parts = self._split_fields(line)
            if len(parts) < 3:
                continue
            ssid = parts[0].strip()
            if not ssid:
                continue
            signal = int(parts[1]) if parts[1].isdigit() else None
            security = parts[2].strip()
            if ssid not in seen or (signal or 0) > (seen[ssid].signal or 0):
                seen[ssid] = WifiNetwork(ssid=ssid, signal=signal, security=security)
        return sorted(seen.values(), key=lambda network: (network.signal or 0), reverse=True)

    def configure_station(self, ssid: str, password: str | None) -> None:
        self._run("nmcli", "connection", "delete", self.settings.station_connection_name, check=False)
        self._run(
            "nmcli", "connection", "add",
            "type", "wifi",
            "ifname", self.settings.station_ifname,
            "con-name", self.settings.station_connection_name,
            "ssid", ssid,
        )
        modify_args = [
            "nmcli", "connection", "modify", self.settings.station_connection_name,
            "connection.autoconnect", "yes",
            "connection.autoconnect-priority", "100",
            "ipv4.method", "auto",
            "ipv6.method", "ignore",
        ]
        if password:
            modify_args.extend([
                "wifi-sec.key-mgmt", "wpa-psk",
                "wifi-sec.psk", password,
            ])
        self._run(*modify_args)

    def connect_station(self) -> None:
        self._run("nmcli", "connection", "up", self.settings.station_connection_name)

    def station_state(self) -> dict[str, str]:
        proc = self._run(
            "nmcli",
            "--terse",
            "--fields",
            "DEVICE,TYPE,STATE,CONNECTION",
            "device",
            "status",
        )
        for line in proc.stdout.splitlines():
            parts = self._split_fields(line)
            if len(parts) < 4:
                continue
            if parts[0] == self.settings.station_ifname:
                return {
                    "device": parts[0],
                    "type": parts[1],
                    "state": parts[2],
                    "connection": parts[3],
                }
        return {"device": self.settings.station_ifname, "type": "wifi", "state": "unknown", "connection": ""}

    def current_station_ssid(self) -> str | None:
        proc = self._run(
            "nmcli",
            "--get-values",
            "GENERAL.CONNECTION",
            "device",
            "show",
            self.settings.station_ifname,
        )
        connection_name = proc.stdout.strip()
        if not connection_name or connection_name == "--":
            return None
        proc = self._run(
            "nmcli",
            "--get-values",
            "802-11-wireless.ssid",
            "connection",
            "show",
            connection_name,
        )
        ssid = proc.stdout.strip()
        return ssid or None

    def active_connections(self) -> list[dict[str, str]]:
        proc = self._run(
            "nmcli",
            "--terse",
            "--fields",
            "NAME,UUID,TYPE,DEVICE",
            "connection",
            "show",
            "--active",
        )
        results: list[dict[str, str]] = []
        for line in proc.stdout.splitlines():
            parts = self._split_fields(line)
            if len(parts) < 4:
                continue
            results.append({"name": parts[0], "uuid": parts[1], "type": parts[2], "device": parts[3]})
        return results

    def system_snapshot(self, *, include_visible_networks: bool = False) -> dict[str, object]:
        snapshot = {
            "station": self.station_state(),
            "current_ssid": self.current_station_ssid(),
            "active_connections": self.active_connections(),
        }
        if include_visible_networks:
            try:
                snapshot["visible_networks"] = [asdict(network) for network in self.scan_wifi()]
            except Exception as exc:
                snapshot["visible_networks"] = []
                snapshot["scan_error"] = str(exc)
        return snapshot
