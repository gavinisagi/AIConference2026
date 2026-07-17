"""Resumable downloader for the first 100 AI Engineer channel videos."""

from __future__ import annotations

import json
from pathlib import Path

import yt_dlp


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "ai_engineer_channel.json"
DESTINATION = ROOT / "data" / "ai_engineer_first_100"
LIMIT = 100


def main() -> None:
    playlist = json.loads(SOURCE.read_text(encoding="utf-8"))
    entries = [entry for entry in playlist.get("entries", []) if entry.get("url")][:LIMIT]
    if len(entries) != LIMIT:
        raise RuntimeError(f"Expected {LIMIT} video URLs, found {len(entries)}")

    DESTINATION.mkdir(parents=True, exist_ok=True)
    # Keep the exact selection so a later retry cannot silently change scope.
    (DESTINATION / "selected_100.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    options = {
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(DESTINATION / "%(title)s [%(id)s].%(ext)s"),
        "download_archive": str(DESTINATION / ".downloaded.txt"),
        "continuedl": True,
        "part": True,
        "windowsfilenames": True,
        "noplaylist": True,
        "retries": 20,
        "fragment_retries": 20,
        "extractor_retries": 10,
        "file_access_retries": 5,
        "sleep_interval_requests": 3,
        "sleep_interval": 8,
        "max_sleep_interval": 20,
        "ratelimit": 2 * 1024 * 1024,
        "concurrent_fragment_downloads": 1,
        "js_runtimes": {"node": {}},
        "ignoreerrors": True,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        status = downloader.download([entry["url"] for entry in entries])
    if status:
        raise SystemExit(status)


if __name__ == "__main__":
    main()
