# -*- coding: utf-8 -*-
"""语句/章节切分：把统一 ASR 分段聚合成 chapter，供章节级 LLM 提炼。

原则（Codex 方案 §3）：LLM 每次输入完整分段，不从句子中间截断；章节按语义/停顿/
时长边界切；时间戳与 segmentId 由程序管理，不让 LLM 猜。
"""
from __future__ import annotations

from . import config


def _is_visual(text: str) -> bool:
    t = text.lower()
    return any(p in t for p in config.VISUAL_TRIGGER_PHRASES)


def build_chapters(asr_result: dict) -> list[dict]:
    """统一 ASR 结果 → chapter 列表。

    边界规则（确定性）：累积分段直到时长 >= CHAPTER_MIN，且遇到长停顿
    (>= CHAPTER_BOUNDARY_GAP) 或时长 >= CHAPTER_MAX 即断章。
    每个 chapter 记录 segmentIds（证据锚点）、起止秒、说话人集合、视觉触发标记。
    """
    segs = asr_result["segments"]
    if not segs:
        return []

    chapters: list[dict] = []
    cur: list[dict] = []
    cur_start = segs[0]["start"]

    for i, s in enumerate(segs):
        cur.append(s)
        dur = s["end"] - cur_start
        gap_next = (segs[i + 1]["start"] - s["end"]) if i + 1 < len(segs) else 999.0
        boundary = dur >= config.CHAPTER_MIN_SECONDS and (
            gap_next >= config.CHAPTER_BOUNDARY_GAP_SECONDS or dur >= config.CHAPTER_MAX_SECONDS
        )
        if boundary or i == len(segs) - 1:
            seg_ids = [x["id"] for x in cur]
            chapters.append({
                "index": len(chapters),
                "title": None,
                "startSeconds": round(cur_start, 2),
                "endSeconds": round(cur[-1]["end"], 2),
                "segmentIds": seg_ids,
                "speakers": sorted({x["speaker"] for x in cur}),
                "text": " ".join(x["text"].strip() for x in cur if x.get("text")),
                "visualDependency": any(_is_visual(x.get("text", "")) for x in cur),
            })
            cur = []
            if i + 1 < len(segs):
                cur_start = segs[i + 1]["start"]

    return chapters


def segment_index(asr_result: dict) -> dict[str, dict]:
    """segmentId → 分段，供聚合阶段按 evidenceSegmentIds 反查时间戳。"""
    return {s["id"]: s for s in asr_result["segments"]}
