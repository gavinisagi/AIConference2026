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

    speakers = draft.get("speakers") or _speakers_from_diarization(asr_result)

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
        "speakers": speakers,
        "whyWatch": draft.get("whyWatch"),
        "takeaways": takeaways,
        # 内部富信息（站点暂不消费）
        "summary": draft.get("summary"),
        "language": asr_result["asr"]["language"],
        "chapters": [
            {"index": c["index"], "title": c["title"], "startSeconds": c["startSeconds"],
             "endSeconds": c["endSeconds"], "visualDependency": c["visualDependency"]}
            for c in chapters
        ],
    }
    return enrichment


def _speakers_from_diarization(asr_result: dict) -> list:
    """无 LLM 姓名归属时，不编造真实姓名，speakers 留空（契约：不伪造姓名）。"""
    return []


def write_enrichment(video_id: str, enrichment: dict) -> str:
    config.ENRICH_DIR.mkdir(parents=True, exist_ok=True)
    out = config.ENRICH_DIR / f"{video_id}.json"
    out.write_text(json.dumps(enrichment, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(out)
