from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import requests

from .dpop import build_dpop_proof


class CrowdPmApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, error_code: str | None = None, payload: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.payload = payload


def derive_htu(url: str, api_base: str | None = None) -> str:
    target = urlparse(url)
    if api_base:
      # Mirror the repo's device-emulator behavior: DPoP htu strips the Functions base prefix.
        base = urlparse(api_base)
        path = target.path
        if path.startswith(base.path.rstrip("/")):
            path = path[len(base.path.rstrip("/")):] or "/"
    else:
        path = target.path or "/"
    return f"{target.scheme}://{target.netloc}{path}"


@dataclass(slots=True)
class PairingSession:
    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    poll_interval: int
    expires_in: int


class CrowdPmApiClient:
    def __init__(self, api_base: str, ingest_url: str):
        self.api_base = api_base.rstrip("/")
        self.ingest_url = ingest_url
        self.session = requests.Session()
        self.session.headers.update({"content-type": "application/json"})

    def _post_json(self, url: str, body: dict[str, Any], *, headers: dict[str, str] | None = None) -> dict[str, Any]:
        response = self.session.post(url, json=body, headers=headers or {}, timeout=20)
        payload: Any
        try:
            payload = response.json()
        except Exception:
            payload = response.text
        if not response.ok:
            error_code = payload.get("error") if isinstance(payload, dict) else None
            message = payload.get("message") if isinstance(payload, dict) else response.text
            raise CrowdPmApiError(
                message or f"HTTP {response.status_code}",
                status_code=response.status_code,
                error_code=error_code,
                payload=payload,
            )
        if not isinstance(payload, dict):
            raise CrowdPmApiError("Expected JSON object response", status_code=response.status_code, payload=payload)
        return payload

    def start_pairing(self, *, public_key_b64url: str, model: str, version: str, nonce: str | None) -> PairingSession:
        payload = self._post_json(
            f"{self.api_base}/device/start",
            {
                "pub_ke": public_key_b64url,
                "model": model,
                "version": version,
                "nonce": nonce,
            },
        )
        return PairingSession(
            device_code=payload["device_code"],
            user_code=payload["user_code"],
            verification_uri=payload["verification_uri"],
            verification_uri_complete=payload.get("verification_uri_complete", payload["verification_uri"]),
            poll_interval=int(payload.get("poll_interval", 5)),
            expires_in=int(payload.get("expires_in", 900)),
        )

    def poll_registration_token(
        self,
        *,
        device_code: str,
        pairing_private_jwk: dict[str, str],
        pairing_public_jwk: dict[str, str],
    ) -> dict[str, Any]:
        url = f"{self.api_base}/device/token"
        dpop = build_dpop_proof(
            htu=derive_htu(url, self.api_base),
            method="POST",
            private_jwk=pairing_private_jwk,
            public_jwk=pairing_public_jwk,
        )
        return self._post_json(
            url,
            {"device_code": device_code},
            headers={
                "DPoP": dpop,
                "x-forwarded-proto": urlparse(url).scheme,
            },
        )

    def register_device(
        self,
        *,
        registration_token: str,
        pairing_private_jwk: dict[str, str],
        pairing_public_jwk: dict[str, str],
        ingest_public_jwk: dict[str, str],
    ) -> dict[str, Any]:
        url = f"{self.api_base}/device/register"
        dpop = build_dpop_proof(
            htu=derive_htu(url, self.api_base),
            method="POST",
            private_jwk=pairing_private_jwk,
            public_jwk=pairing_public_jwk,
        )
        return self._post_json(
            url,
            {"jwk_pub_kl": ingest_public_jwk},
            headers={
                "Authorization": f"Bearer {registration_token}",
                "DPoP": dpop,
                "x-forwarded-proto": urlparse(url).scheme,
            },
        )

    def mint_access_token(
        self,
        *,
        device_id: str,
        ingest_private_jwk: dict[str, str],
        ingest_public_jwk: dict[str, str],
    ) -> dict[str, Any]:
        url = f"{self.api_base}/device/access-token"
        dpop = build_dpop_proof(
            htu=derive_htu(url, self.api_base),
            method="POST",
            private_jwk=ingest_private_jwk,
            public_jwk=ingest_public_jwk,
        )
        return self._post_json(
            url,
            {"device_id": device_id, "scope": ["ingest.write"]},
            headers={
                "DPoP": dpop,
                "x-forwarded-proto": urlparse(url).scheme,
            },
        )

    def submit_batch(
        self,
        *,
        device_id: str,
        access_token: str,
        ingest_private_jwk: dict[str, str],
        ingest_public_jwk: dict[str, str],
        points: list[dict[str, Any]],
    ) -> dict[str, Any]:
        url = self.ingest_url
        dpop = build_dpop_proof(
            htu=derive_htu(url, self.ingest_url),
            method="POST",
            private_jwk=ingest_private_jwk,
            public_jwk=ingest_public_jwk,
        )
        return self._post_json(
            url,
            {"device_id": device_id, "points": points},
            headers={
                "Authorization": f"Bearer {access_token}",
                "DPoP": dpop,
                "x-forwarded-proto": urlparse(url).scheme,
            },
        )

    def network_ok(self) -> bool:
        try:
            response = self.session.get(self.api_base, timeout=10)
            return response.status_code < 500
        except Exception:
            return False
