# -*- coding: utf-8 -*-
"""LLM 提炼：章节级结构化提取 + 全片 Reduce。urllib 直调 Anthropic Messages API。

关键约束（Codex 方案 §3）：
- 每条 claim 必须回指至少一个 evidenceSegmentId（证据链），时间戳由程序据此计算。
- LLM 不写散文摘要于章节层，只吐严格 JSON。
- whyWatch 最后生成（先有证据观点，再写编辑文案）。
- 无 ANTHROPIC_API_KEY 或 --dry-run：走确定性桩，管道可端到端跑通（质量待真实 key）。
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from . import config

ROLES = ("developer", "product-design", "founder-lead", "trend")
TOPICS = ("agent", "ai-coding", "evals", "context", "design-to-code", "ai-product")


class LLMError(RuntimeError):
    pass


def has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _call(system: str, user: str, max_tokens: int = config.LLM_MAX_TOKENS) -> str:
    """调 Messages API，返回文本内容。仅在有 key 时使用。"""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise LLMError("未设置 ANTHROPIC_API_KEY")
    body = json.dumps({
        "model": config.LLM_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }).encode("utf-8")
    req = urllib.request.Request(
        config.LLM_API_URL, data=body, method="POST",
        headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": config.LLM_API_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise LLMError(f"Anthropic API HTTP {e.code}: {e.read().decode('utf-8')[:500]}") from e
    except urllib.error.URLError as e:
        raise LLMError(f"Anthropic API 网络错误: {e}") from e
    parts = [b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip()


def _parse_json(text: str) -> dict:
    """从模型输出中稳健提取 JSON 对象（容忍 ```json 围栏）。"""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
        t = t.rsplit("```", 1)[0] if "```" in t else t
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1:
        raise LLMError(f"模型输出无 JSON：{text[:200]}")
    return json.loads(t[start:end + 1])


# --- 章节级提取 ---------------------------------------------------------

_CHAPTER_SYS = (
    "你是技术大会视频的分析器。给定一个章节的逐段转写（每段带 segmentId），"
    "提炼该章节的观点。严格要求：\n"
    "1) 每条 claim 必须在 evidenceSegmentIds 引用至少一个给定的 segmentId，不得编造 id。\n"
    "2) 不要输出时间戳（由程序据 evidenceSegmentIds 计算）。\n"
    "3) 只输出 JSON，无多余文字。\n"
    "4) confidence/novelty/actionability 取 0~1。roles 取子集：developer, product-design, "
    "founder-lead, trend。\n"
    "输出形如：{\"chapterTitle\":\"...\",\"summary\":\"...\",\"claims\":[{\"statement\":\"...\","
    "\"evidenceSegmentIds\":[\"seg_00012\"],\"confidence\":0.8,\"novelty\":0.6,"
    "\"actionability\":0.5,\"visualDependency\":false,\"roles\":[\"developer\"]}]}"
)


def extract_chapter(chapter: dict, dry_run: bool) -> dict:
    """章节 → 结构化提取 JSON。dry_run 走确定性桩。"""
    seg_ids = chapter["segmentIds"]
    if dry_run or not has_api_key():
        return _stub_chapter(chapter)

    user = json.dumps({
        "chapterIndex": chapter["index"],
        "availableSegmentIds": seg_ids,
        "transcript": chapter["text"][:8000],
        "speakers": chapter["speakers"],
    }, ensure_ascii=False)
    out = _parse_json(_call(_CHAPTER_SYS, user))
    # 清洗：evidence 只保留本章节存在的 segmentId。
    valid = set(seg_ids)
    for c in out.get("claims", []):
        c["evidenceSegmentIds"] = [x for x in c.get("evidenceSegmentIds", []) if x in valid]
    out.setdefault("chapterTitle", None)
    return out


def _stub_chapter(chapter: dict) -> dict:
    """确定性桩：取本章首句为 statement，首个 segmentId 为证据。仅供管道联调。"""
    text = chapter["text"].strip()
    first = (text.split(". ")[0][:160] or "（无文本）").strip()
    seg_ids = chapter["segmentIds"]
    return {
        "chapterTitle": None,
        "summary": text[:200],
        "claims": [{
            "statement": first,
            "evidenceSegmentIds": seg_ids[:1],
            "confidence": 0.55,
            "novelty": 0.5,
            "actionability": 0.5,
            "visualDependency": chapter.get("visualDependency", False),
            "roles": [],
            "_stub": True,
        }] if seg_ids else [],
    }


# --- 全片 Reduce --------------------------------------------------------

_REDUCE_SYS = (
    "你是内容编辑。给定一场大会演讲各章节提炼出的 claims，做全片汇总。任务：\n"
    "1) 去重、合并相近观点，按重要性排序，保留最多 N 条 takeaways。\n"
    "2) 每条 takeaway 保留其 evidenceSegmentIds（从输入 claim 继承，不得新造 id）。\n"
    "3) 写一句话 whyWatch（为什么值得看，中文，克制不夸张）。\n"
    "4) 给出 topics（子集：agent, ai-coding, evals, context, design-to-code, ai-product）"
    "与 roles（子集：developer, product-design, founder-lead, trend）。\n"
    "5) 只输出 JSON。形如：{\"whyWatch\":\"...\",\"summary\":\"...\",\"topics\":[...],"
    "\"roles\":[...],\"takeaways\":[{\"statement\":\"...\",\"context\":\"...\","
    "\"evidenceSegmentIds\":[\"seg_00012\"],\"confidence\":0.8,\"roles\":[\"developer\"]}]}"
)


def reduce_video(chapter_extracts: list[dict], title: str, dry_run: bool) -> dict:
    """章节提取列表 → 全片 enrichment 草稿（未投影）。dry_run 走确定性桩。"""
    all_claims = [c for ex in chapter_extracts for c in ex.get("claims", [])]
    if dry_run or not has_api_key():
        return _stub_reduce(all_claims, title)

    user = json.dumps({
        "title": title,
        "maxTakeaways": config.MAX_TAKEAWAYS_PER_VIDEO,
        "claims": all_claims,
    }, ensure_ascii=False)
    out = _parse_json(_call(_REDUCE_SYS, user, max_tokens=config.LLM_MAX_TOKENS))
    out["topics"] = [t for t in out.get("topics", []) if t in TOPICS]
    out["roles"] = [r for r in out.get("roles", []) if r in ROLES]
    return out


def _stub_reduce(all_claims: list[dict], title: str) -> dict:
    """确定性桩：按 confidence 取前 N 条 claim 作 takeaways。"""
    ranked = sorted(all_claims, key=lambda c: c.get("confidence", 0), reverse=True)
    top = ranked[: config.MAX_TAKEAWAYS_PER_VIDEO]
    return {
        "whyWatch": None,   # 桩不编造推荐语，保持 null 让站点走降级
        "summary": None,
        "topics": [],
        "roles": [],
        "takeaways": [{
            "statement": c["statement"],
            "context": None,
            "evidenceSegmentIds": c.get("evidenceSegmentIds", []),
            "confidence": c.get("confidence", 0.5),
            "roles": c.get("roles", []),
            "_stub": True,
        } for c in top],
        "_stub": True,
    }
