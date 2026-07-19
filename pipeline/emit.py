# -*- coding: utf-8 -*-
"""产出 data/enrichments/<videoId>.json（对应 contracts/enrichment-contract.md §2）。

时间戳由 evidenceSegmentIds 反查 seg_index 计算（不采信 LLM 猜的时间）。
按 MIN_TAKEAWAY_CONFIDENCE 过滤、MAX_TAKEAWAYS_PER_VIDEO 封顶。
"""
from __future__ import annotations

import json

from . import config


def build_enrichment(
    video_id: str,
    draft: dict,
    seg_index: dict,
    asr_result: dict,
    chapters: list[dict],
    dry_run: bool,
    speakers: list[dict] | None = None,
    visual: dict | None = None,
    tour: dict | None = None,
    frames: list[dict] | None = None,
) -> dict:
    takeaways = []
    for i, tk in enumerate(draft.get("takeaways", [])):
        if tk.get("confidence", 0) < config.MIN_TAKEAWAY_CONFIDENCE:
            continue
        ev = [e for e in tk.get("evidenceSegmentIds", []) if e in seg_index]
        ts = round(min(seg_index[e]["start"] for e in ev), 2) if ev else None
        takeaways.append({
            "id": f"{video_id}-tk{i + 1}",
            "sessionId": video_id,
            "statement": tk["statement"],
            "context": tk.get("context"),
            "timestampSeconds": ts,
            "roles": [r for r in tk.get("roles", []) if r in ("developer", "product-design", "founder-lead", "trend")],
            "evidenceSegmentIds": ev,
            "confidence": tk.get("confidence"),
        })
    takeaways = takeaways[: config.MAX_TAKEAWAYS_PER_VIDEO]

    speaker_inferences = speakers or []
    # 投影到站点 speakers：仅高置信推断，形如 {name, org}（契约：不伪造姓名）。
    projected_speakers = [
        {"name": sp["name"], "org": sp.get("org")}
        for sp in speaker_inferences
        if sp.get("name") and sp.get("confidence", 0) >= config.SPEAKER_MIN_CONFIDENCE
    ]

    enrichment = {
        "schemaVersion": config.ENRICHMENT_SCHEMA_VERSION,
        "videoId": video_id,
        "generatedBy": {
            "pipelineVersion": config.PIPELINE_VERSION,
            "asrProvider": asr_result["asr"]["provider"],
            "asrModel": asr_result["asr"]["model"],
            "llmModel": config.LLM_MODEL,
            "dryRun": bool(dry_run),
        },
        # 投影字段（build-data 消费）
        "topics": draft.get("topics") or None,
        "roles": draft.get("roles") or [],
        "speakers": projected_speakers,
        "whyWatch": draft.get("whyWatch"),
        "takeaways": takeaways,
        # 内部富信息（站点暂不消费）
        "summary": draft.get("summary"),
        "language": asr_result["asr"]["language"],
        # 说话人推断全量（含低置信/依据），供人工审核；站点只取上面 projected。
        "speakerInferences": [
            {"speaker": sp["speaker"], "name": sp.get("name"), "org": sp.get("org"),
             "confidence": sp.get("confidence"), "basis": sp.get("basis")}
            for sp in speaker_inferences
        ],
        # 值得抽帧看图像的具体时刻（段级，带触发原文与深链秒）。
        "visualMoments": (visual or {}).get("moments", []),
        # 观看导览（承接层核心资产；生成失败/桩不足 → null，站点走详情降级）。
        "tour": tour,
        # 留存的关键帧（可读屏幕内容；只有讲者/黑帧不留）。
        "frames": frames or [],
        "chapters": [
            {"index": c["index"], "title": c["title"], "startSeconds": c["startSeconds"],
             "endSeconds": c["endSeconds"], "visualDependency": c["visualDependency"]}
            for c in chapters
        ],
    }
    return enrichment


def write_enrichment(video_id: str, enrichment: dict) -> str:
    config.ENRICH_DIR.mkdir(parents=True, exist_ok=True)
    out = config.ENRICH_DIR / f"{video_id}.json"
    out.write_text(json.dumps(enrichment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(out)
