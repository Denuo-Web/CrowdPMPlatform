from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class QueuedMeasurement:
    id: int
    point: dict[str, Any]
    temperature_c: float | None
    humidity_pct: float | None


class QueueDb:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _initialize(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS measurements (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  point_json TEXT NOT NULL,
                  temperature_c REAL,
                  humidity_pct REAL,
                  created_at TEXT NOT NULL,
                  uploaded_at TEXT,
                  error TEXT
                )
                """
            )
            conn.commit()

    def enqueue_point(self, point: dict[str, Any], temperature_c: float | None, humidity_pct: float | None) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO measurements (point_json, temperature_c, humidity_pct, created_at)
                VALUES (?, ?, ?, datetime('now'))
                """,
                (json.dumps(point, separators=(",", ":")), temperature_c, humidity_pct),
            )
            conn.commit()

    def pending_count(self) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM measurements WHERE uploaded_at IS NULL").fetchone()
            return int(row["c"])

    def oldest_pending(self, limit: int) -> list[QueuedMeasurement]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, point_json, temperature_c, humidity_pct
                FROM measurements
                WHERE uploaded_at IS NULL
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [
            QueuedMeasurement(
                id=int(row["id"]),
                point=json.loads(row["point_json"]),
                temperature_c=row["temperature_c"],
                humidity_pct=row["humidity_pct"],
            )
            for row in rows
        ]

    def mark_uploaded(self, ids: list[int]) -> None:
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE measurements SET uploaded_at = datetime('now'), error = NULL WHERE id IN ({placeholders})",
                ids,
            )
            conn.commit()

    def mark_error(self, ids: list[int], error: str) -> None:
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        with self._connect() as conn:
            conn.execute(
                f"UPDATE measurements SET error = ? WHERE id IN ({placeholders})",
                [error, *ids],
            )
            conn.commit()
