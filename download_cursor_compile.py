"""Download the public Cursor Compile 2026 videos listed in the local JSON."""

from __future__ import annotations

import json
from pathlib import Path

import yt_dlp


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "data" / "cursor_compile_2026.json"
DESTINATION = ROOT / "data" / "cursor_compile_2026"


def main() -> None:
    playlist = json.loads(SOURCE.read_text(encoding="utf-8"))
    urls = [entry["url"] for entry in playlist["entries"] if entry.get("url")]
    if not urls:
        raise RuntimeError(f"No video URLs found in {SOURCE}")

    DESTINATION.mkdir(parents=True, exist_ok=True)
    options = {
        # Best separate video and audio streams, with a safe fallback if only
        # one combined stream is available.
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "outtmpl": str(DESTINATION / "%(title)s [%(id)s].%(ext)s"),
        "download_archive": str(DESTINATION / ".downloaded.txt"),
        "windowsfilenames": True,
        "noplaylist": True,
        "retries": 10,
        "fragment_retries": 10,
        "continuedl": True,
        "ignoreerrors": True,
        "js_runtimes": {"node": {}},
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        status = downloader.download(urls)
    if status:
        raise SystemExit(status)


if __name__ == "__main__":
    main()
