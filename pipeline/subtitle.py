# -*- coding: utf-8 -*-
"""字幕导出：统一 ASR 结果 → SRT / VTT（英文 / 中英双语）。

双语 = 英文在上、中文在下，一条 cue 两行，媒体播放器直接显示。翻译用 claude -p 批量。
文件默认写到视频旁边同名（<basename>.en.srt / .zh.srt / .srt），播放器可自动加载。
"""
from __future__ import annotations

import json
from pathlib import Path

from . import config, llm


def _ts_srt(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1_000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _ts_vtt(sec: float) -> str:
    return _ts_srt(sec).replace(",", ".")


def _cue_lines(seg: dict, zh: str, speaker: bool) -> list[str]:
    en = seg["text"].strip()
    prefix = f"[{seg['speaker']}] " if speaker else ""
    lines = []
    if en:
        lines.append(prefix + en)
    if zh:
        lines.append((prefix if not en else "") + zh)
    return lines or [prefix.strip() or "…"]


def build_srt(asr_result: dict, translations: list[str] | None = None, speaker: bool = False) -> str:
    segs = asr_result["segments"]
    tr = translations or ["" for _ in segs]
    out = []
    for i, seg in enumerate(segs):
        zh = tr[i] if i < len(tr) else ""
        out.append(str(i + 1))
        out.append(f"{_ts_srt(seg['start'])} --> {_ts_srt(seg['end'])}")
        out.extend(_cue_lines(seg, zh, speaker))
        out.append("")
    return "\n".join(out) + "\n"


def build_vtt(asr_result: dict, translations: list[str] | None = None, speaker: bool = False) -> str:
    segs = asr_result["segments"]
    tr = translations or ["" for _ in segs]
    out = ["WEBVTT", ""]
    for i, seg in enumerate(segs):
        zh = tr[i] if i < len(tr) else ""
        out.append(f"{_ts_vtt(seg['start'])} --> {_ts_vtt(seg['end'])}")
        out.extend(_cue_lines(seg, zh, speaker))
        out.append("")
    return "\n".join(out) + "\n"


def export(
    asr_result: dict,
    out_dir: Path,
    basename: str,
    langs=("en", "bi"),
    fmt: str = "srt",
    speaker: bool = False,
    dry_run: bool = False,
    cache_path: Path | None = None,
) -> list[str]:
    """导出字幕。langs 子集 of {en, zh, bi}；bi/zh 需翻译（claude -p）。返回写出的文件路径。

    翻译缓存：cache_path 存在且与分段数一致则复用（重出不同格式不再重复付费翻译）。
    文件按 UTF-8 **带 BOM**(utf-8-sig)写出——否则 Windows 播放器易按 GBK 解码致中文乱码。
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    need_zh = any(l in ("zh", "bi") for l in langs)
    segs = asr_result["segments"]
    translations = None
    if need_zh:
        if cache_path and cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if len(cached) == len(segs):
                translations = cached
                print(f"  [subtitle] 复用翻译缓存 {cache_path.name}")
        if translations is None:
            print(f"  [subtitle] 翻译 {len(segs)} 行…")
            translations = llm.translate_batch([s["text"] for s in segs], dry_run)
            if cache_path and any(translations):
                cache_path.write_text(json.dumps(translations, ensure_ascii=False), encoding="utf-8")

    builder = build_vtt if fmt == "vtt" else build_srt
    ext = "vtt" if fmt == "vtt" else "srt"
    written = []

    for l in langs:
        if l == "en":
            content = builder(asr_result, None, speaker)
            name = f"{basename}.en.{ext}"
        elif l == "zh":
            # 纯中文：把 en 位置换成 zh（无 zh 的行留英文兜底）
            content = _build_zh_only(asr_result, translations, builder, speaker)
            name = f"{basename}.zh.{ext}"
        elif l == "bi":
            content = builder(asr_result, translations, speaker)
            name = f"{basename}.{ext}"
        else:
            continue
        path = out_dir / name
        # utf-8-sig = 带 BOM，Windows 播放器据此识别 UTF-8，中文不乱码。
        path.write_text(content, encoding="utf-8-sig")
        written.append(str(path))
    return written


def _build_zh_only(asr_result, translations, builder, speaker):
    """纯中文字幕：用译文替换 text（缺译文的行保留英文兜底）。"""
    import copy
    clone = copy.deepcopy(asr_result)
    tr = translations or []
    for i, seg in enumerate(clone["segments"]):
        zh = tr[i] if i < len(tr) else ""
        if zh:
            seg["text"] = zh
    return builder(clone, None, speaker)
