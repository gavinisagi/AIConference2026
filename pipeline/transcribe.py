# -*- coding: utf-8 -*-
"""ASR 编排：把媒体转成统一 ASR 结果。

三条路径：
  1) from_moss_result：适配现有 mossASR/results/*.json（今天联调用）。
  2) Moss CLI（就绪时）：≤28min 整片直转；>28min 由本模块切块 → 逐块调 → 拼接。
  3) 都不可用：明确报错。

切块拼接（长视频）：块内时间加块偏移 → 绝对时间；按 core 区间去重叠；全局重编 seg id；
多块时 speakerScope 标 'chunk'（跨块 S01 不保证同一人，由后续 embedding 匹配，不在此）。
"""
from __future__ import annotations

from pathlib import Path

from . import config, media
from .asr import adapter, moss, schema


def transcribe_video(video_id: str, media_path, from_moss_result, work: Path, dry_run: bool) -> dict:
    if from_moss_result:
        return adapter.from_moss_result(from_moss_result, video_id)

    if not media_path:
        raise RuntimeError(
            f"{video_id}: 无本地媒体文件且未提供 --from-moss-result，无法转写。"
        )
    if not moss.available():
        raise RuntimeError(
            "Moss CLI 未就绪（mossASR/scripts/moss_transcribe.py 不存在）。"
            "该部分由另一 session 按 mossASR/ASR_CONTRACT.md 部署；"
            "联调可先用 --from-moss-result 指向现有转写。"
        )

    manifest = media.probe(media_path, video_id)
    duration = manifest["durationSeconds"]
    chunks = media.plan_chunks(duration)

    prompt = _hotword_prompt(video_id)
    if len(chunks) == 1:
        result = moss.transcribe_file(media_path, video_id, prompt)
        return result

    # 多块：抽块 → 逐块转 → 拼接。
    chunk_dir = work / "chunks"
    chunk_results = []
    for ch in chunks:
        flac = media.extract_chunk(media_path, ch, chunk_dir)
        r = moss.transcribe_file(flac, video_id, prompt)
        chunk_results.append((ch, r))
    return _stitch(video_id, media_path, duration, chunk_results)


def _stitch(video_id, media_path, duration, chunk_results) -> dict:
    """拼接多块统一结果为整片统一结果。"""
    merged_segs = []
    provider = model = language = None
    for ch, r in chunk_results:
        provider = r["asr"]["provider"]
        model = r["asr"]["model"]
        language = r["asr"]["language"]
        offset = ch.start
        for s in r["segments"]:
            abs_start = s["start"] + offset
            abs_end = s["end"] + offset
            # 去重叠：只保留落在本块 core 区间内的段（重叠部分归相邻块一次）。
            if abs_start < ch.core_start - 1e-6 or abs_start >= ch.core_end - 1e-6:
                if not (ch.index == 0 and abs_start < ch.core_end):
                    continue
            merged_segs.append({**s, "start": round(abs_start, 2), "end": round(abs_end, 2)})

    merged_segs.sort(key=lambda s: s["start"])
    for i, s in enumerate(merged_segs):
        s["id"] = f"seg_{i + 1:05d}"

    result = {
        "schemaVersion": 1,
        "source": {
            "videoId": video_id, "inputPath": str(media_path),
            "mediaSha256": None, "durationSeconds": round(duration, 2),
        },
        "asr": {
            "provider": provider, "model": model, "backend": None,
            "language": language or "en",
            "speakerScope": "chunk",   # 跨块 speaker 不保证一致
            "createdAt": None, "inferenceSeconds": None, "rtf": None,
        },
        "segments": merged_segs,
    }
    return schema.validate(result)


def _hotword_prompt(video_id: str) -> str | None:
    """按 catalog 标题构造轻量热词提示（提高专有名词识别）。"""
    rec = config.load_catalog().get(video_id, {})
    title = rec.get("title", "")
    if not title:
        return None
    return (
        "请将音频转写为文本，每段以起始时间戳和说话人编号（[S01]、[S02]…）开头，"
        f"段末标注结束时间戳。参考标题（含可能的专有名词）：{title}"
    )
