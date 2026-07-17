# -*- coding: utf-8 -*-
"""把 mossASR/results/<name>.json（现有产出）适配为统一 ASR 结果 schema。

用途二重：
  1) 桥接现有转写，今天就能端到端跑通流水线（无需等新 CLI）。
  2) 作为 producer 输出对照——另一 session 的 moss_transcribe.py 应直接产出统一
     schema，届时本 adapter 可退役。

现有 moss json 形状：
  {audio, model, backend, duration_seconds, inference_seconds, rtf,
   segments:[{start,end,speaker,text}]}
"""
from __future__ import annotations

import json
from pathlib import Path

from .. import config
from . import schema


def _detect_language(segments: list[dict]) -> str:
    """粗判主语言：CJK 字符占比高 → zh，否则 en。producer 侧应给更准的值。"""
    text = " ".join(s.get("text", "") for s in segments[:50])
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return "zh" if cjk > max(10, len(text) * 0.1) else "en"


def from_moss_result(moss_json_path: str | Path, video_id: str | None = None) -> dict:
    """读现有 moss 结果 → 统一 schema（已校验）。"""
    p = Path(moss_json_path)
    raw = json.loads(p.read_text(encoding="utf-8"))

    input_path = raw.get("audio") or str(p)
    vid = video_id or config.parse_video_id(input_path) or config.parse_video_id(p)
    if not vid:
        raise ValueError(f"无法从 {p.name} 解析 videoId，请显式传入 video_id")

    raw_segs = raw.get("segments", [])
    segments = [
        {
            "id": f"seg_{i + 1:05d}",
            "start": float(s["start"]),
            "end": float(s["end"]),
            "speaker": s["speaker"],
            "text": s.get("text", ""),
            "avgLogprob": None,
        }
        for i, s in enumerate(raw_segs)
    ]

    result = {
        "schemaVersion": 1,
        "source": {
            "videoId": vid,
            "inputPath": str(input_path),
            "mediaSha256": None,
            "durationSeconds": float(raw.get("duration_seconds") or _infer_duration(segments)),
        },
        "asr": {
            "provider": "moss-asr",
            "model": raw.get("model") or "OpenMOSS-Team/MOSS-Transcribe-Diarize",
            "backend": raw.get("backend"),
            "language": _detect_language(raw_segs),
            "speakerScope": "global",
            "createdAt": None,
            "inferenceSeconds": raw.get("inference_seconds"),
            "rtf": raw.get("rtf"),
        },
        "segments": segments,
    }
    return schema.validate(result)


def _infer_duration(segments: list[dict]) -> float:
    return max((s["end"] for s in segments), default=1.0)
