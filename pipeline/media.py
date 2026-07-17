# -*- coding: utf-8 -*-
"""媒体探测与长视频切分（系统原生 ffprobe/ffmpeg，无需 WSL）。

- probe(): ffprobe → manifest（时长/分辨率/帧率/音轨/是否可解码），与 catalog 时长比对。
- plan_chunks(): >28min 视频的切块计划（目标 25min、重叠 12s）。
- extract_chunk(): 按时间范围抽 16kHz 单声道 FLAC，交给 ASR provider。
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

from . import config


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")


def ffprobe(path: str | Path) -> dict:
    """ffprobe → 原始 format+streams JSON。"""
    cmd = [
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    proc = _run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe 失败：{proc.stderr[-500:]}")
    return json.loads(proc.stdout)


def probe(path: str | Path, video_id: str) -> dict:
    """生成媒体 manifest，含与 catalog 时长的一致性检查。"""
    path = Path(path)
    info = ffprobe(path)
    fmt = info.get("format", {})
    streams = info.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    duration = float(fmt.get("duration") or 0.0)
    catalog = config.load_catalog().get(video_id, {})
    catalog_dur = catalog.get("duration")
    drift = (
        abs(duration - catalog_dur) if isinstance(catalog_dur, (int, float)) and catalog_dur else None
    )

    manifest = {
        "videoId": video_id,
        "path": str(path),
        "sizeBytes": path.stat().st_size,
        "durationSeconds": round(duration, 2),
        "catalogDurationSeconds": catalog_dur,
        "durationDriftSeconds": round(drift, 2) if drift is not None else None,
        "width": v.get("width") if v else None,
        "height": v.get("height") if v else None,
        "fps": _parse_fps(v.get("r_frame_rate")) if v else None,
        "audioTrackCount": len(audio_streams),
        "decodable": duration > 0 and len(audio_streams) > 0,
        "needsChunking": duration > config.SINGLE_PASS_MAX_SECONDS,
        "warnings": _probe_warnings(path, duration, audio_streams, drift),
    }
    return manifest


def _probe_warnings(path: Path, duration: float, audio_streams: list, drift) -> list[str]:
    w = []
    if path.stat().st_size == 0:
        w.append("零字节文件")
    if duration <= 0:
        w.append("时长为 0 或无法解码")
    if not audio_streams:
        w.append("无音轨")
    if len(audio_streams) > 1:
        w.append(f"多音轨（{len(audio_streams)}），ASR 前需确认选轨")
    if drift is not None and drift > 5:
        w.append(f"与 catalog 时长偏差 {drift:.1f}s")
    return w


def _parse_fps(r: str | None) -> float | None:
    if not r or "/" not in r:
        return None
    try:
        num, den = r.split("/")
        return round(int(num) / int(den), 3) if int(den) else None
    except (ValueError, ZeroDivisionError):
        return None


@dataclass
class Chunk:
    index: int
    start: float
    end: float          # 含重叠的实际抽取区间
    core_start: float   # 去重用的“核心”区间（重叠归前一块）
    core_end: float


def plan_chunks(duration: float) -> list[Chunk]:
    """>28min 的切块计划：目标 25min + 12s 重叠。返回带核心区间的块列表。

    ≤28min 返回单块（覆盖全片，无重叠）。核心区间用于拼接时消除重叠重复。
    """
    if duration <= config.SINGLE_PASS_MAX_SECONDS:
        return [Chunk(0, 0.0, duration, 0.0, duration)]

    target = config.CHUNK_TARGET_SECONDS
    ov = config.CHUNK_OVERLAP_SECONDS
    chunks: list[Chunk] = []
    idx = 0
    pos = 0.0
    while pos < duration - 1e-6:
        core_start = pos
        core_end = min(pos + target, duration)
        start = max(0.0, core_start - (ov if idx > 0 else 0))
        end = min(duration, core_end + (ov if core_end < duration else 0))
        chunks.append(Chunk(idx, round(start, 2), round(end, 2), round(core_start, 2), round(core_end, 2)))
        pos = core_end
        idx += 1
    return chunks


def extract_chunk(src: str | Path, chunk: Chunk, out_dir: Path) -> Path:
    """按块时间范围抽 16kHz 单声道 FLAC（喂 ASR provider 用）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    dst = out_dir / f"chunk_{chunk.index:03d}.flac"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", str(chunk.start), "-to", str(chunk.end), "-i", str(src),
        "-ac", "1", "-ar", "16000", "-c:a", "flac", str(dst),
    ]
    proc = _run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 抽块失败：{proc.stderr[-500:]}")
    return dst


def chunk_to_dict(c: Chunk) -> dict:
    return asdict(c)


def extract_audio_full(src: str | Path, out_dir: Path) -> Path:
    """用 Windows 原生 ffmpeg 把整片抽成 16kHz 单声道 FLAC。

    绕开 mossASR CLI 内部的 WSL ffmpeg（跨 /mnt/c 慢 10 倍）。产出 .flac 传给 Moss，
    因 .flac 非视频后缀，CLI 不会再做二次抽取，直接送模型。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    src = Path(src)
    dst = out_dir / f"{src.stem[:40]}_16k.flac"
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
        "-ac", "1", "-ar", "16000", "-c:a", "flac", str(dst),
    ]
    proc = _run(cmd)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg 抽音频失败：{proc.stderr[-500:]}")
    return dst
