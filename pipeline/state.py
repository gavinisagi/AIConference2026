# -*- coding: utf-8 -*-
"""流水线状态存储（SQLite）：每视频、每阶段的状态，支持断点续跑。

状态机：pending → running → succeeded | failed | skipped。
失败只重跑失败阶段，不重转整条视频。
"""
from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager

from . import config

STAGES = ("probe", "transcribe", "segment", "extract", "aggregate", "speaker", "visual", "tour", "audience", "frames", "qc", "emit", "i18n_en")

PENDING, RUNNING, SUCCEEDED, FAILED, SKIPPED = "pending", "running", "succeeded", "failed", "skipped"


def _connect() -> sqlite3.Connection:
    config.WORK_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.STATE_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS stage_state (
            video_id   TEXT NOT NULL,
            stage      TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'pending',
            attempts   INTEGER NOT NULL DEFAULT 0,
            error      TEXT,
            updated_at REAL,
            PRIMARY KEY (video_id, stage)
        )
        """
    )
    return conn


@contextmanager
def _db():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def get_status(video_id: str, stage: str) -> str:
    with _db() as conn:
        row = conn.execute(
            "SELECT status FROM stage_state WHERE video_id=? AND stage=?", (video_id, stage)
        ).fetchone()
    return row[0] if row else PENDING


def set_status(video_id: str, stage: str, status: str, error: str | None = None) -> None:
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO stage_state (video_id, stage, status, attempts, error, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            ON CONFLICT(video_id, stage) DO UPDATE SET
                status=excluded.status,
                attempts=stage_state.attempts + 1,
                error=excluded.error,
                updated_at=excluded.updated_at
            """,
            (video_id, stage, status, error, time.time()),
        )


def video_stages(video_id: str) -> dict[str, str]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT stage, status FROM stage_state WHERE video_id=?", (video_id,)
        ).fetchall()
    d = {s: PENDING for s in STAGES}
    d.update({stage: status for stage, status in rows})
    return d


def all_video_ids() -> list[str]:
    with _db() as conn:
        rows = conn.execute("SELECT DISTINCT video_id FROM stage_state ORDER BY video_id").fetchall()
    return [r[0] for r in rows]


def reset(video_id: str, stage: str | None = None) -> None:
    """清除状态以便重跑（stage=None 清整条视频）。"""
    with _db() as conn:
        if stage:
            conn.execute("DELETE FROM stage_state WHERE video_id=? AND stage=?", (video_id, stage))
        else:
            conn.execute("DELETE FROM stage_state WHERE video_id=?", (video_id,))
