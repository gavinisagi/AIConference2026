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
import shutil
import subprocess
import time
import urllib.error
import urllib.request

from . import config

# claude -p / API 偶发瞬时失败（exit 1、限流、网络）。批处理规模下必须重试，
# 否则单场瞬时错误会累积成大量假失败。指数退避。
LLM_RETRIES = 3
LLM_RETRY_BACKOFF_SECONDS = 8

ROLES = ("developer", "product-design", "founder-lead", "trend")
TOPICS = ("agent", "ai-coding", "evals", "context", "design-to-code", "ai-product")


class LLMError(RuntimeError):
    pass


def has_api_key() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _claude_cli() -> str | None:
    """定位 claude CLI（headless 后端，走用户现有 Claude Code 登录，免 API key）。"""
    return os.environ.get("CLAUDE_BIN") or shutil.which("claude")


def resolve_backend() -> str:
    """选择 LLM 后端：环境显式 > claude-cli（默认，零配置）> api-key > stub。

    PIPELINE_LLM_BACKEND ∈ {claude-cli, api, stub} 可强制。
    """
    forced = os.environ.get("PIPELINE_LLM_BACKEND")
    if forced in {"claude-cli", "api", "stub"}:
        return forced
    if _claude_cli():
        return "claude-cli"
    if has_api_key():
        return "api"
    return "stub"


def _call(system: str, user: str, max_tokens: int = config.LLM_MAX_TOKENS) -> str:
    """按当前后端调 LLM（含瞬时失败重试），返回模型文本。stub 后端不应走到这里。"""
    backend = resolve_backend()
    if backend == "stub":
        raise LLMError(f"当前后端为 {backend}，不应调用 _call")

    last: Exception | None = None
    for attempt in range(1, LLM_RETRIES + 1):
        try:
            if backend == "api":
                return _call_api(system, user, max_tokens)
            return _call_claude_cli(system, user)
        except LLMError as e:
            last = e
            if attempt < LLM_RETRIES:
                wait = LLM_RETRY_BACKOFF_SECONDS * attempt
                print(f"  [llm] {backend} 第 {attempt} 次失败，{wait}s 后重试：{str(e)[:120]}")
                time.sleep(wait)
    raise LLMError(f"{backend} 连续 {LLM_RETRIES} 次失败：{last}")


def _call_api(system: str, user: str, max_tokens: int) -> str:
    """Anthropic Messages API（urllib 直连，需 ANTHROPIC_API_KEY）。"""
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
        with urllib.request.urlopen(req, timeout=180) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise LLMError(f"Anthropic API HTTP {e.code}: {e.read().decode('utf-8')[:500]}") from e
    except urllib.error.URLError as e:
        raise LLMError(f"Anthropic API 网络错误: {e}") from e
    parts = [b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"]
    return "".join(parts).strip()


def _call_claude_cli(system: str, user: str) -> str:
    """headless `claude -p`：走用户 Claude Code 登录，免 API key。

    system 作为附加系统提示，user 经 stdin 传入；--output-format json 取信封 .result。
    注意：每次调用有 CC 系统提示开销，故上层按「每场一次」批处理以压低次数。
    """
    exe = _claude_cli()
    if not exe:
        raise LLMError("未找到 claude CLI（可设 CLAUDE_BIN）")
    cmd = [
        exe, "-p", "--output-format", "json",
        "--append-system-prompt", system,
        "--max-turns", "1",
    ]
    try:
        proc = subprocess.run(
            cmd, input=user, capture_output=True, text=True,
            encoding="utf-8", timeout=600,
        )
    except subprocess.TimeoutExpired as e:
        raise LLMError("claude -p 超时（>600s）") from e
    if proc.returncode != 0:
        raise LLMError(f"claude -p 失败（exit {proc.returncode}）：{proc.stderr[-500:]}")
    try:
        env = json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise LLMError(f"claude -p 输出非 JSON 信封：{proc.stdout[:300]}") from e
    if env.get("is_error"):
        raise LLMError(f"claude -p 报错：{env.get('result', '')[:300]}")
    return str(env.get("result", "")).strip()


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


def _use_stub(dry_run: bool) -> bool:
    return dry_run or resolve_backend() == "stub"


def extract_chapter(chapter: dict, dry_run: bool) -> dict:
    """单章节 → 结构化提取 JSON。dry_run/stub 走确定性桩。

    注意：批量场景请用 extract_chapters_batched（整场一次调用，省 claude -p 开销）。
    """
    seg_ids = chapter["segmentIds"]
    if _use_stub(dry_run):
        return _stub_chapter(chapter)

    user = json.dumps({
        "chapterIndex": chapter["index"],
        "availableSegmentIds": seg_ids,
        "transcript": chapter["text"][:8000],
        "speakers": chapter["speakers"],
    }, ensure_ascii=False)
    out = _parse_json(_call(_CHAPTER_SYS, user))
    return _sanitize_extract(out, seg_ids)


def _sanitize_extract(out: dict, seg_ids) -> dict:
    """清洗单章节提取：evidence 只保留本章节存在的 segmentId。"""
    valid = set(seg_ids)
    for c in out.get("claims", []):
        c["evidenceSegmentIds"] = [x for x in c.get("evidenceSegmentIds", []) if x in valid]
    out.setdefault("chapterTitle", None)
    out.setdefault("claims", [])
    return out


_BATCH_SYS = _CHAPTER_SYS + (
    "\n\n批量模式：输入含多个章节，逐个处理，输出一个 JSON 数组，元素与单章节格式一致，"
    "且各元素含 \"chapterIndex\" 字段对应输入章节。evidenceSegmentIds 只能引用该章节自己的 "
    "availableSegmentIds。只输出 JSON 数组。"
)


def extract_chapters_batched(chapters: list[dict], dry_run: bool) -> list[dict]:
    """整场所有章节 → 一次调用返回全部章节提取（省 claude -p 每次系统提示开销）。

    stub/dry_run 逐章节走桩。真实后端一次请求，失败时回退到逐章节（保证鲁棒）。
    """
    if _use_stub(dry_run):
        return [_stub_chapter(c) for c in chapters]
    if not chapters:
        return []

    payload = {
        "chapters": [
            {
                "chapterIndex": c["index"],
                "availableSegmentIds": c["segmentIds"],
                "transcript": c["text"][:6000],
                "speakers": c["speakers"],
            }
            for c in chapters
        ]
    }
    try:
        raw = _call(_BATCH_SYS, json.dumps(payload, ensure_ascii=False))
        arr = _parse_json_array(raw)
        by_idx = {a.get("chapterIndex"): a for a in arr if isinstance(a, dict)}
        out = []
        for c in chapters:
            ex = by_idx.get(c["index"], {"claims": []})
            out.append(_sanitize_extract(ex, c["segmentIds"]))
        return out
    except LLMError:
        # 批量失败回退逐章节（更慢但更稳）。
        return [extract_chapter(c, dry_run) for c in chapters]


def _parse_json_array(text: str) -> list:
    """从模型输出提取 JSON 数组（容忍围栏/前后缀）。"""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        if t.startswith("json"):
            t = t[4:]
        t = t.rsplit("```", 1)[0] if "```" in t else t
    start, end = t.find("["), t.rfind("]")
    if start == -1 or end == -1:
        raise LLMError(f"模型输出无 JSON 数组：{text[:200]}")
    return json.loads(t[start:end + 1])


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
    if _use_stub(dry_run):
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


# --- 说话人推断 --------------------------------------------------------

_SPEAKER_SYS = (
    "你是会议记录分析器。给定演讲标题和每个说话人编号(S01/S02..)的若干发言样本，"
    "推断每人的真实姓名与所属组织。依据：自我介绍('I'm X'/'my name is')、相互交接"
    "('let me hand to X')、标题中的人名、以及角色线索。严格要求：\n"
    "1) 拿不准就把 name/org 置 null，不要编造；confidence 反映把握(0~1)。\n"
    "2) basis 用一句话说明依据(引用关键线索)。\n"
    "3) 只输出 JSON 数组，元素形如 {\"speaker\":\"S01\",\"name\":\"...\"或null,"
    "\"org\":\"...\"或null,\"confidence\":0.0~1.0,\"basis\":\"...\"}。"
)


def _speaker_samples(asr_result: dict) -> dict:
    """每个说话人取样发言：优先含自我介绍/交接线索的段，补足到上限。"""
    cues = ("i'm ", "i am ", "my name", "name is", "hand ", "welcome ", "join me", "co-founder", "ceo", "cto")
    by_spk: dict[str, list[str]] = {}
    for s in asr_result["segments"]:
        by_spk.setdefault(s["speaker"], [])
    for sp in by_spk:
        segs = [s for s in asr_result["segments"] if s["speaker"] == sp]
        cued = [s["text"] for s in segs if any(c in s["text"].lower() for c in cues)]
        head = [s["text"] for s in segs[:4]]
        picked = list(dict.fromkeys(cued + head))[: config.SPEAKER_SAMPLE_SEGMENTS]
        by_spk[sp] = picked
    return by_spk


def infer_speakers(asr_result: dict, title: str, dry_run: bool) -> list[dict]:
    """推断各说话人身份，带置信度与依据。dry_run/stub → 全 null。"""
    labels = sorted({s["speaker"] for s in asr_result["segments"]})
    if _use_stub(dry_run):
        return [{"speaker": sp, "name": None, "org": None, "confidence": 0.0, "basis": "stub"} for sp in labels]

    user = json.dumps({"title": title, "speakerSamples": _speaker_samples(asr_result)}, ensure_ascii=False)
    try:
        arr = _parse_json_array(_call(_SPEAKER_SYS, user))
    except LLMError:
        return [{"speaker": sp, "name": None, "org": None, "confidence": 0.0, "basis": "推断失败"} for sp in labels]

    by_label = {a.get("speaker"): a for a in arr if isinstance(a, dict)}
    out = []
    for sp in labels:
        a = by_label.get(sp, {})
        name = a.get("name") if isinstance(a.get("name"), str) and a.get("name").strip() else None
        org = a.get("org") if isinstance(a.get("org"), str) and a.get("org").strip() else None
        conf = a.get("confidence")
        conf = float(conf) if isinstance(conf, (int, float)) and not isinstance(conf, bool) else 0.0
        out.append({
            "speaker": sp, "name": name, "org": org,
            "confidence": round(max(0.0, min(1.0, conf)), 2),
            "basis": a.get("basis") if isinstance(a.get("basis"), str) else None,
        })
    return out


# --- 观看导览 ----------------------------------------------------------

_TOUR_SYS = (
    "你是资深技术内容编辑，为一场大会演讲做【观看导览】，目的是推荐给别人、帮他们决定看不看、"
    "怎么看，不要写成流水账 summary。输入含：章节(带 visualDependency=是否有值得看的画面)、"
    "关键观点(带时间戳)、讲者、视觉时刻(visualMoments，LLM 判定值得抽帧看的点)、whyWatch。\n"
    "严格输出 JSON：{\n"
    '  "hook":"一句话钩子，说清独特价值(<=40字)",\n'
    '  "whoShouldWatch":"一句话谁最该看",\n'
    '  "ifShortOnTime":"时间不够看哪段(给具体时间点和理由)",\n'
    '  "mustWatch":[{"startSeconds":int,"endSeconds":int,"label":"<=12字","live":bool,"why":"为何必看"}],\n'
    '  "stops":[{"startSeconds":int,"endSeconds":int,"title":"小标题","what":"讲了什么(1-2句)",'
    '"keyPoint":"最该记住的一点","howTo":"watch|skim|listen","howToReason":"为何这样看(结合视觉)","speaker":"姓名或S0x"}]\n'
    "}\n"
    "要求：stops 覆盖全片、按时间顺序、5-8 站；howTo=watch 用于有现场演示/值得看画面的段"
    "(参考 visualDependency 与 visualMoments)，skim 用于幻灯片图表，listen 用于纯口头论述。"
    "mustWatch 取 1-3 个最有价值的画面/演示。只输出 JSON。"
)


def build_tour(payload: dict, dry_run: bool) -> dict | None:
    """章节/观点/讲者/视觉 → 观看导览。dry_run/stub → 由章节确定性生成基础导览。"""
    chapters = payload.get("chapters", [])
    if _use_stub(dry_run):
        if not chapters:
            return None
        stops = [{
            "startSeconds": c.get("startSeconds", 0),
            "endSeconds": c.get("endSeconds", 0),
            "title": c.get("title") or f"第 {i + 1} 段",
            "what": "", "keyPoint": "",
            "howTo": "watch" if c.get("visualDependency") else "listen",
            "howToReason": "", "speaker": "",
        } for i, c in enumerate(chapters)]
        return {
            "hook": payload.get("whyWatch") or payload.get("title") or "",
            "whoShouldWatch": "", "ifShortOnTime": "", "mustWatch": [], "stops": stops,
        }

    try:
        out = _parse_json(_call(_TOUR_SYS, json.dumps(payload, ensure_ascii=False)))
    except LLMError:
        return None
    if not isinstance(out.get("stops"), list) or not out["stops"]:
        return None
    out.setdefault("hook", payload.get("whyWatch") or "")
    out.setdefault("whoShouldWatch", "")
    out.setdefault("ifShortOnTime", "")
    out.setdefault("mustWatch", [])
    return out


# --- 字幕翻译 ----------------------------------------------------------

_TRANSLATE_SYS = (
    "你是字幕译者。把大会演讲转录的英文字幕行逐条译成自然、口语化的简体中文。要求：\n"
    "1) 保留技术术语、产品名、公司名的英文原文(如 agent、Cursor、Composer、Git、SDK)。\n"
    "2) 每行是一条字幕，译文要简短适合屏幕显示，不合并不拆分。\n"
    "3) 严格逐条对应，输入几条就输出几条。\n"
    "4) 只输出 JSON 数组，元素 {\"i\":<输入序号>,\"zh\":\"译文\"}。"
)
TRANSLATE_BATCH = 40


def translate_batch(texts: list[str], dry_run: bool) -> list[str]:
    """把英文字幕行批量译为中文，返回与输入等长的译文列表。

    dry_run/stub 或失败 → 返回空串列表(上层降级为纯英文字幕)。分批 + 对齐校验，
    缺失/错位的条目留空串，不编造、不错位。
    """
    if _use_stub(dry_run) or not texts:
        return ["" for _ in texts]

    out = ["" for _ in texts]
    for base in range(0, len(texts), TRANSLATE_BATCH):
        chunk = texts[base:base + TRANSLATE_BATCH]
        user = json.dumps([{"i": i, "en": t} for i, t in enumerate(chunk)], ensure_ascii=False)
        try:
            arr = _parse_json_array(_call(_TRANSLATE_SYS, user))
        except LLMError as e:
            print(f"  [translate] 批 {base} 失败，留空降级：{str(e)[:80]}")
            continue
        for item in arr:
            if isinstance(item, dict) and isinstance(item.get("i"), int):
                idx = base + item["i"]
                if base <= idx < base + len(chunk) and isinstance(item.get("zh"), str):
                    out[idx] = item["zh"].strip()
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
