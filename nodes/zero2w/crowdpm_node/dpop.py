from __future__ import annotations

import base64
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def unb64url(data: str) -> bytes:
    padding = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode(data + padding)


def jwk_from_private_key(private_key: Ed25519PrivateKey) -> dict[str, str]:
    private_bytes = private_key.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.Raw,
        serialization.PublicFormat.Raw,
    )
    return {
        "kty": "OKP",
        "crv": "Ed25519",
        "x": b64url(public_bytes),
        "d": b64url(private_bytes),
    }


def public_jwk_from_private_jwk(private_jwk: dict[str, str]) -> dict[str, str]:
    return {
        "kty": private_jwk["kty"],
        "crv": private_jwk["crv"],
        "x": private_jwk["x"],
    }


def private_key_from_jwk(private_jwk: dict[str, str]) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(unb64url(private_jwk["d"]))


def generate_keypair() -> tuple[dict[str, str], dict[str, str]]:
    private_key = Ed25519PrivateKey.generate()
    private_jwk = jwk_from_private_key(private_key)
    public_jwk = public_jwk_from_private_jwk(private_jwk)
    return public_jwk, private_jwk


def _json_b64(data: dict[str, Any]) -> str:
    return b64url(json.dumps(data, separators=(",", ":"), sort_keys=False).encode("utf-8"))


def build_dpop_proof(
    *,
    htu: str,
    method: str,
    private_jwk: dict[str, str],
    public_jwk: dict[str, str],
) -> str:
    header = {
        "alg": "EdDSA",
        "typ": "dpop+jwt",
        "jwk": public_jwk,
    }
    payload = {
        "htm": method.upper(),
        "htu": htu,
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "jti": str(uuid.uuid4()),
    }
    encoded_header = _json_b64(header)
    encoded_payload = _json_b64(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = private_key_from_jwk(private_jwk).sign(signing_input)
    return f"{encoded_header}.{encoded_payload}.{b64url(signature)}"


def fingerprint_public_jwk(public_jwk: dict[str, str]) -> str:
    digest = hashlib.sha256(json.dumps(public_jwk, sort_keys=True).encode("utf-8")).hexdigest()
    return digest[:16]
