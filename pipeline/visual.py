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

from . import media


def has_gemini_key() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


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
