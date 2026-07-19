# -*- coding: utf-8 -*-
"""会议级信号聚合：横切一届大会的全部 enrichment → 「这个领域正在发生什么」。

不是逐场复述，而是跨场归纳。目标：读者 3 分钟拿到整届大会的 payload，再决定深入哪场。
每条信号带 sources 深链（videoId + 时间戳），沿用「观点必须能回指出处」的原则。
产出 data/digests/<conferenceId>.json，由 build-data 投影进站点。
"""
from __future__ import annotations

import json
from pathlib import Path

from . import config, llm

DIGEST_DIR = config.DATA_DIR / "digests"

# catalog source key → 站点 conferenceId（与 build-data CONFERENCES 对齐）。
CONFERENCE_SOURCES = {v: k for k, v in config.SOURCE_TO_CONFERENCE.items()}


def _load_enrichments(conference_id: str) -> list[dict]:
    """取该大会全部已清洗 enrichment（按 catalog 的 source 归属过滤）。"""
    source_key = CONFERENCE_SOURCES.get(conference_id)
    catalog = config.load_catalog()
    out = []
    if not config.ENRICH_DIR.exists():
        return out
    for f in sorted(config.ENRICH_DIR.glob("*.json")):
        vid = f.stem
        rec = catalog.get(vid)
        if not rec or rec.get("source") != source_key:
            continue
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return out


def generate_digest(conference_id: str, dry_run: bool) -> dict | None:
    """产出会议信号聚合；无 enrichment 或生成失败 → None。"""
    enrichments = _load_enrichments(conference_id)
    if not enrichments:
        print(f"  [digest] {conference_id}: 无 enrichment，跳过")
        return None

    catalog = config.load_catalog()
    talks = []
    for e in enrichments:
        vid = e.get("videoId")
        talks.append({
            "videoId": vid,
            "title": catalog.get(vid, {}).get("title", ""),
            "hook": (e.get("tour") or {}).get("hook"),
            "whoShouldWatch": (e.get("tour") or {}).get("whoShouldWatch"),
            "takeaways": [
                {"statement": t.get("statement"), "timestampSeconds": t.get("timestampSeconds")}
                for t in e.get("takeaways", [])
            ],
        })

    payload = {"conferenceId": conference_id, "talkCount": len(talks), "talks": talks}
    print(f"  [digest] {conference_id}: 聚合 {len(talks)} 场…")
    out = llm.build_digest(payload, dry_run)
    if not out:
        return None

    # 清洗 sources：只保留真实存在的 videoId，时间戳取该场真实 takeaway 的时刻。
    valid_ids = {t["videoId"] for t in talks}
    ts_by_video = {
        t["videoId"]: [x["timestampSeconds"] for x in t["takeaways"] if x.get("timestampSeconds") is not None]
        for t in talks
    }
    for sig in out["signals"]:
        cleaned = []
        for s in sig.get("sources", []):
            vid = s.get("videoId")
            if vid not in valid_ids:
                continue
            ts = s.get("timestampSeconds")
            if not isinstance(ts, (int, float)):
                ts = (ts_by_video.get(vid) or [None])[0]
            cleaned.append({"videoId": vid, "timestampSeconds": ts})
        sig["sources"] = cleaned

    return {
        "schemaVersion": 1,
        "conferenceId": conference_id,
        "talkCount": len(talks),
        "headline": out["headline"],
        "narrative": out["narrative"],
        "signals": out["signals"],
        "generatedBy": {"pipelineVersion": config.PIPELINE_VERSION, "llmModel": config.LLM_MODEL},
    }


def write_digest(conference_id: str, digest: dict) -> str:
    DIGEST_DIR.mkdir(parents=True, exist_ok=True)
    p = DIGEST_DIR / f"{conference_id}.json"
    p.write_text(json.dumps(digest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return str(p)
