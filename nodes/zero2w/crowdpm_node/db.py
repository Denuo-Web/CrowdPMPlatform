from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(slots=True)
class QueuedMeasurement:
    id: int
    batch_id: str
    point: dict[str, Any]
    temperature_c: float | None
    humidity_pct: float | None


@dataclass(slots=True)
class QueueBatchWindow:
    batch_id: str
    point_count: int
    started_at: str | None
    closed_at: str | None = None


class QueueDb:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        return conn

    def _column_names(self, conn: sqlite3.Connection) -> set[str]:
        rows = conn.execute("PRAGMA table_info(measurements)").fetchall()
        return {str(row["name"]) for row in rows}

    def _migrate_legacy_batches(self, conn: sqlite3.Connection) -> None:
        legacy_rows = conn.execute("SELECT COUNT(*) AS c FROM measurements WHERE batch_id IS NULL").fetchone()
        if legacy_rows and int(legacy_rows["c"]):
            migrated_at = utc_now_iso()
            pending_batch_id = self.next_batch_id(prefix="legacy-pending")
            uploaded_batch_id = self.next_batch_id(prefix="legacy-uploaded")
            conn.execute(
                """
                UPDATE measurements
                SET batch_id = CASE
                    WHEN uploaded_at IS NULL THEN ?
                    ELSE ?
                  END,
                    batch_closed_at = CASE
                    WHEN uploaded_at IS NULL THEN ?
                    ELSE COALESCE(uploaded_at, created_at, ?)
                  END
                WHERE batch_id IS NULL
                """,
                (pending_batch_id, uploaded_batch_id, migrated_at, migrated_at),
            )
        conn.execute(
            """
            UPDATE measurements
            SET batch_closed_at = COALESCE(batch_closed_at, uploaded_at, created_at, ?)
            WHERE uploaded_at IS NOT NULL AND batch_closed_at IS NULL
            """,
            (utc_now_iso(),),
        )

    def _initialize(self) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS measurements (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  batch_id TEXT,
                  batch_closed_at TEXT,
                  point_json TEXT NOT NULL,
                  temperature_c REAL,
                  humidity_pct REAL,
                  created_at TEXT NOT NULL,
                  uploaded_at TEXT,
                  error TEXT
                )
                """
            )
            columns = self._column_names(conn)
            if "batch_id" not in columns:
                conn.execute("ALTER TABLE measurements ADD COLUMN batch_id TEXT")
            if "batch_closed_at" not in columns:
                conn.execute("ALTER TABLE measurements ADD COLUMN batch_closed_at TEXT")
            self._migrate_legacy_batches(conn)
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_measurements_pending_batches
                ON measurements (uploaded_at, batch_closed_at, batch_id, id)
                """
            )
            conn.commit()

    def next_batch_id(self, *, prefix: str = "local") -> str:
        return f"{prefix}-{uuid.uuid4().hex}"

    def enqueue_point(
        self,
        point: dict[str, Any],
        temperature_c: float | None,
        humidity_pct: float | None,
        *,
        batch_id: str,
    ) -> None:
        with closing(self._connect()) as conn:
            conn.execute(
                """
                INSERT INTO measurements (batch_id, batch_closed_at, point_json, temperature_c, humidity_pct, created_at)
                VALUES (?, NULL, ?, ?, ?, ?)
                """,
                (batch_id, json.dumps(point, separators=(",", ":")), temperature_c, humidity_pct, utc_now_iso()),
            )
            conn.commit()

    def pending_count(self) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute("SELECT COUNT(*) AS c FROM measurements WHERE uploaded_at IS NULL").fetchone()
            return int(row["c"])

    def pending_closed_batch_count(self) -> int:
        with closing(self._connect()) as conn:
            row = conn.execute(
                """
                SELECT COUNT(DISTINCT batch_id) AS c
                FROM measurements
                WHERE uploaded_at IS NULL
                  AND batch_closed_at IS NOT NULL
                  AND batch_id IS NOT NULL
                """
            ).fetchone()
            return int(row["c"])

    def current_open_batch(self) -> QueueBatchWindow | None:
        with closing(self._connect()) as conn:
            row = conn.execute(
                """
                SELECT batch_id, COUNT(*) AS point_count, MIN(created_at) AS started_at, MAX(id) AS last_id
                FROM measurements
                WHERE uploaded_at IS NULL
                  AND batch_closed_at IS NULL
                  AND batch_id IS NOT NULL
                GROUP BY batch_id
                ORDER BY last_id DESC
                LIMIT 1
                """
            ).fetchone()
        if not row:
            return None
        return QueueBatchWindow(
            batch_id=str(row["batch_id"]),
            point_count=int(row["point_count"]),
            started_at=row["started_at"],
        )

    def oldest_pending(self, limit: int) -> list[QueuedMeasurement]:
        with closing(self._connect()) as conn:
            batch_row = conn.execute(
                """
                SELECT batch_id, MIN(batch_closed_at) AS closed_at
                FROM measurements
                WHERE uploaded_at IS NULL
                  AND batch_closed_at IS NOT NULL
                  AND batch_id IS NOT NULL
                GROUP BY batch_id
                ORDER BY MIN(id) ASC
                LIMIT 1
                """
            ).fetchone()
            if not batch_row:
                return []
            rows = conn.execute(
                """
                SELECT id, batch_id, point_json, temperature_c, humidity_pct
                FROM measurements
                WHERE uploaded_at IS NULL
                  AND batch_id = ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (batch_row["batch_id"], limit),
            ).fetchall()
        return [
            QueuedMeasurement(
                id=int(row["id"]),
                batch_id=str(row["batch_id"]),
                point=json.loads(row["point_json"]),
                temperature_c=row["temperature_c"],
                humidity_pct=row["humidity_pct"],
            )
            for row in rows
        ]

    def close_open_batches(self, *, closed_at: str | None = None) -> int:
        with closing(self._connect()) as conn:
            cursor = conn.execute(
                """
                UPDATE measurements
                SET batch_closed_at = ?
                WHERE uploaded_at IS NULL
                  AND batch_closed_at IS NULL
                  AND batch_id IS NOT NULL
                """,
                (closed_at or utc_now_iso(),),
            )
            conn.commit()
            return int(cursor.rowcount or 0)

    def mark_uploaded(self, ids: list[int]) -> None:
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        with closing(self._connect()) as conn:
            conn.execute(
                f"UPDATE measurements SET uploaded_at = datetime('now'), error = NULL WHERE id IN ({placeholders})",
                ids,
            )
            conn.commit()

    def mark_error(self, ids: list[int], error: str) -> None:
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        with closing(self._connect()) as conn:
            conn.execute(
                f"UPDATE measurements SET error = ? WHERE id IN ({placeholders})",
                [error, *ids],
            )
            conn.commit()

    def status_summary(self) -> dict[str, Any]:
        open_batch = self.current_open_batch()
        return {
            "pending_count": self.pending_count(),
            "closed_batch_count": self.pending_closed_batch_count(),
            "open_batch": asdict(open_batch) if open_batch else None,
        }
