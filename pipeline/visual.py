# -*- coding: utf-8 -*-
"""按需视觉解析：触发检测 + 关键帧计划。真实 Gemini 调用待 GEMINI_API_KEY。

原则（Codex 方案 §4）：不固定每 N 秒抽帧全量发 Gemini（多为讲者头像）；
仅在以下情形触发，产出关键帧抽取计划：
  - 章节含视觉指代短语（segment.build_chapters 已标 visualDependency）
  - claim 被标 visualDependency=true
视觉结果只“补充”语音结论，不无证据覆盖转录。
"""
from __future__ import annotations

import os

from . import config, media


def has_gemini_key() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def find_visual_moments(asr_result: dict, extracts: list[dict] | None = None,
                        seg_index: dict | None = None) -> list[dict]:
    """产出「值得抽帧看图像」的具体时刻，两路信号合并去重（按时间就近 15s 内视为同一处）：

    - llm（主）：extract 阶段 LLM 判定 visualDependency=true 的 claim → 其证据最早时刻 +
      观点作为 reason。内容感知，比关键词准。
    - keyword（补）：段文本命中视觉指代短语（as you can see / this chart / 演示…）。

    每条标 source，reason/quote 便于人工判断该不该真去截图。
    """
    seg_index = seg_index or {s["id"]: s for s in asr_result["segments"]}
    raw: list[dict] = []

    # 主：LLM 判定需视觉的 claim
    for ex in extracts or []:
        for c in ex.get("claims", []):
            if not c.get("visualDependency"):
                continue
            ev = [e for e in c.get("evidenceSegmentIds", []) if e in seg_index]
            if not ev:
                continue
            ts = min(seg_index[e]["start"] for e in ev)
            raw.append({
                "timestampSeconds": round(ts, 2),
                "segmentId": min(ev, key=lambda e: seg_index[e]["start"]),
                "speaker": seg_index[ev[0]]["speaker"],
                "source": "llm",
                "reason": str(c.get("statement", ""))[:120],
            })

    # 补：关键词命中
    for s in asr_result["segments"]:
        low = s.get("text", "").lower()
        hit = next((p for p in config.VISUAL_TRIGGER_PHRASES if p in low), None)
        if hit:
            raw.append({
                "timestampSeconds": round(s["start"], 2),
                "segmentId": s["id"],
                "speaker": s["speaker"],
                "source": "keyword",
                "trigger": hit,
                "quote": s["text"][:120],
            })

    # 去重：按时间排序，15s 内相邻的合并（优先保留 llm 源）。
    raw.sort(key=lambda m: (m["timestampSeconds"], 0 if m["source"] == "llm" else 1))
    merged: list[dict] = []
    for m in raw:
        if merged and abs(m["timestampSeconds"] - merged[-1]["timestampSeconds"]) < 15:
            continue
        merged.append(m)
    return merged[: config.MAX_VISUAL_MOMENTS]


def plan_visual(chapters: list[dict], chapter_extracts: list[dict]) -> list[dict]:
    """扫描章节/claim，产出需视觉证据的抽帧计划（候选时间点前后取 3~6 帧）。"""
    plan: list[dict] = []
    for ch, ex in zip(chapters, chapter_extracts):
        needs = ch.get("visualDependency") or any(
            c.get("visualDependency") for c in ex.get("claims", [])
        )
        if not needs:
            continue
        mid = round((ch["startSeconds"] + ch["endSeconds"]) / 2, 2)
        plan.append({
            "chapterIndex": ch["index"],
            "reason": "章节含视觉指代或 claim.visualDependency",
            "sampleAtSeconds": mid,
            "frameOffsetsSeconds": [-6, -3, 0, 3, 6],
            "segmentIds": ch["segmentIds"],
        })
    return plan


def run_visual(video_path, plan: list[dict], dry_run: bool) -> list[dict]:
    """执行视觉解析。dry_run 或无 key：只返回计划（不抽帧、不调 Gemini）。

    真实实现（待接入）：按 plan 用 ffmpeg 抽帧 → 去黑帧/模糊/感知哈希去重 →
    组 contact sheet → 调 Gemini flash 输出「屏幕事实/时间/补充说明/置信度」。
    """
    if dry_run or not has_gemini_key() or not plan:
        return [{**p, "status": "planned", "observations": []} for p in plan]
    # TODO(接入 Gemini)：抽帧 + contact sheet + API 调用。当前不阻塞主流程。
    results = []
    for p in plan:
        results.append({**p, "status": "skipped-no-impl", "observations": []})
    return results
