"""Resumable, rate-conscious downloader for the public Figma Config 2026 list."""

from __future__ import annotations

import json
from pathlib import Path

import yt_dlp


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "figma_config_2026.json"
DESTINATION = ROOT / "data" / "figma_config_2026"


def main() -> None:
    playlist = json.loads(SOURCE.read_text(encoding="utf-8"))
    urls = [entry["url"] for entry in playlist["entries"] if entry.get("url")]
    if not urls:
        raise RuntimeError(f"No video URLs found in {SOURCE}")

    DESTINATION.mkdir(parents=True, exist_ok=True)
    options = {
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(DESTINATION / "%(title)s [%(id)s].%(ext)s"),
        # Archive IDs only after a full file is completed; safe to rerun.
        "download_archive": str(DESTINATION / ".downloaded.txt"),
        "continuedl": True,
        "part": True,
        "windowsfilenames": True,
        "noplaylist": True,
        "retries": 20,
        "fragment_retries": 20,
        "extractor_retries": 10,
        "file_access_retries": 5,
        # Be gentle with YouTube so transient throttling is less likely.
        "sleep_interval_requests": 3,
        "sleep_interval": 8,
        "max_sleep_interval": 20,
        "ratelimit": 2 * 1024 * 1024,
        "concurrent_fragment_downloads": 1,
        "js_runtimes": {"node": {}},
        "ignoreerrors": True,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        status = downloader.download(urls)
    if status:
        raise SystemExit(status)


if __name__ == "__main__":
    main()
