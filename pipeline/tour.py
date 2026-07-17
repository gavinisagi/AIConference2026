# -*- coding: utf-8 -*-
"""观看导览生成：把章节/观点/讲者/视觉组装成 payload → llm.build_tour。

承接层核心资产（不是 summary，是「推荐别人看」的观看指南）。视觉信号用章节
visualDependency + 视觉时刻（visual 阶段产出），不依赖昂贵的密集抽帧分类。
"""
from __future__ import annotations

from . import config, llm


def _titled_chapters(chapters: list[dict], extracts: list[dict]) -> list[dict]:
    """用 extract 阶段的 chapterTitle 回填章节标题（供导览小标题）。"""
    titles = {ex.get("chapterIndex", i): ex.get("chapterTitle") for i, ex in enumerate(extracts)}
    return [{**c, "title": titles.get(c["index"]) or c.get("title")} for c in chapters]


def generate_tour(
    video_id: str,
    draft: dict,
    chapters: list[dict],
    extracts: list[dict],
    speakers: list[dict],
    visual: dict,
    dry_run: bool,
) -> dict | None:
    """产出观看导览 dict（缺章节/生成失败 → None，enrichment 走 tour=null 降级）。"""
    titled = _titled_chapters(chapters, extracts)
    title = config.load_catalog().get(video_id, {}).get("title", "")
    duration = chapters[-1]["endSeconds"] if chapters else None

    payload = {
        "title": title,
        "durationSeconds": duration,
        "whyWatch": draft.get("whyWatch"),
        "summary": draft.get("summary"),
        "speakers": [
            {"speaker": s.get("speaker"), "name": s.get("name"), "org": s.get("org")}
            for s in (speakers or [])
        ],
        "chapters": [
            {"title": c.get("title"), "startSeconds": c["startSeconds"],
             "endSeconds": c["endSeconds"], "visualDependency": c.get("visualDependency", False)}
            for c in titled
        ],
        "takeaways": [
            {"statement": t.get("statement"), "timestampSeconds": t.get("timestampSeconds")}
            for t in draft.get("takeaways", [])
        ],
        "visualMoments": (visual or {}).get("moments", []),
    }
    return llm.build_tour(payload, dry_run)
