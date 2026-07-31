# -*- coding: utf-8 -*-
"""LLM 提炼：章节级结构化提取 + 全片 Reduce。urllib 直调 Anthropic Messages API。

关键约束（Codex 方案 §3）：
- 每条 claim 必须回指至少一个 evidenceSegmentId（证据链），时间戳由程序据此计算。
- LLM 不写散文摘要于章节层，只吐严格 JSON。
- whyWatch 最后生成（先有证据观点，再写编辑文案）。
- 无 ANTHROPIC_API_KEY 或 --dry-run：走确定性桩，管道可端到端跑通（质量待真实 key）。
"""
from __future__ import annotations

import contextlib
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

# 并发闸：任意时刻至多 N 个 claude -p 子进程在飞行中（跨进程文件锁，N 个编号槽位）。
#
# subprocess.run(..., timeout=600) 自身超时是安全的——Python 会正确杀掉子进程。
# 但若外部强行终止了正在等待它的父进程（如外层 timeout 命令、被中断的批处理脚本），
# Windows 的 TerminateProcess 不会级联杀死子进程，claude.exe 就会变成孤儿留存。
# 多次误操作叠加后曾在本机堆出十余个孤儿 claude -p 进程，抢占内存把交互中的
# Claude Desktop 顶到无响应/崩溃。这把锁把「同时至多 N 个」做成硬约束，不依赖
# 调用方守规矩——即便真出现孤儿或误触发的并发调用，超额部分也只会排队而非抢跑。
#
# N 默认 1（历史行为不变）。PIPELINE_MAX_CONCURRENT_CLI 可临时调高——仅用于
# 时间紧张的批量任务（如 i18n_en 大批渲染），且前提是当前无外部强杀风险
# （孤儿堆积的根因是「强杀父进程」，不是「并发」本身）。调用方用完应改回 1。
_CLI_LOCK_DIR = config.WORK_DIR
_CLI_LOCK_STALE_SECONDS = 700  # 单次 claude -p 上限 600s + 冗余，超过视为孤儿锁
_CLI_LOCK_POLL_SECONDS = 2
_CLI_LOCK_LOG_EVERY_SECONDS = 30


def _max_concurrent_cli() -> int:
    try:
        n = int(os.environ.get("PIPELINE_MAX_CONCURRENT_CLI", "1"))
    except ValueError:
        return 1
    return max(1, n)


@contextlib.contextmanager
def _claude_cli_lock():
    _CLI_LOCK_DIR.mkdir(parents=True, exist_ok=True)
    n = _max_concurrent_cli()
    waited = 0
    held_path = None
    while held_path is None:
        for slot in range(n):
            path = _CLI_LOCK_DIR / f".claude-cli-{slot}.lock"
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.write(fd, str(os.getpid()).encode("utf-8"))
                os.close(fd)
                held_path = path
                break
            except FileExistsError:
                try:
                    age = time.time() - os.path.getmtime(path)
                except FileNotFoundError:
                    continue  # 锁在探测间隙被释放，下一轮会抢到
                if age > _CLI_LOCK_STALE_SECONDS:
                    print(f"  [llm] 打破孤儿锁 slot={slot}（{age:.0f}s 未释放，持有进程已消失）")
                    with contextlib.suppress(FileNotFoundError):
                        os.remove(path)
        if held_path is None:
            if waited % _CLI_LOCK_LOG_EVERY_SECONDS == 0:
                print(f"  [llm] 等待并发闸（{n} 个槽位均在飞行中，已等 {waited}s）")
            time.sleep(_CLI_LOCK_POLL_SECONDS)
            waited += _CLI_LOCK_POLL_SECONDS
    try:
        yield
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.remove(held_path)

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


def _call(system: str, user: str, max_tokens: int = config.LLM_MAX_TOKENS, max_turns: int = 1) -> str:
    """按当前后端调 LLM（含瞬时失败重试），返回模型文本。stub 后端不应走到这里。

    max_turns：claude -p 的轮次上限。纯文本任务 1 轮即可；**视觉任务必须 >1**——
    读图片需要模型调用 Read 工具，限死 1 轮会让调用直接失败。
    """
    backend = resolve_backend()
    if backend == "stub":
        raise LLMError(f"当前后端为 {backend}，不应调用 _call")

    last: Exception | None = None
    for attempt in range(1, LLM_RETRIES + 1):
        try:
            if backend == "api":
                return _call_api(system, user, max_tokens)
            return _call_claude_cli(system, user, max_turns)
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


def _call_claude_cli(system: str, user: str, max_turns: int = 1) -> str:
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
        "--max-turns", str(max_turns),
    ]
    try:
        with _claude_cli_lock():
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


# --- 受众重组（结构化「谁该看」）----------------------------------------
# 不重新转录：只把 tour 阶段已产出的 whoShouldWatch/ifShortOnTime 与全片
# takeaways 喂回去，让模型把「一句话谁该看」重组成 {who, why} 列表，
# 并按需给出一条「不适合谁」——比重新提取全片内容便宜得多。

_AUDIENCE_SYS = (
    "你在把一份「谁该看」的一句话总结，重组成分角色的结构化列表，供导览页展示。"
    "输入含该场的一句话钩子、谁该看、时间不够看哪段、几条关键观点、话题标签。"
    "严格输出 JSON 数组，2-4 个元素，元素形如 "
    '{"who":"<=10字的角色/人群","why":"该角色为何该看，<=30字，须具体不空泛","fit":"recommended"|"not_recommended"}。'
    "要求：\n"
    "1) 前几项 fit=recommended，按最该看到较该看排序，why 要落到具体收获（引用观点里的实质内容），不要写"
    "「适合关心该领域的人」这类空话。\n"
    "2) 若能合理判断出「这场明显不适合谁」（如内容太基础/太前沿/无落地案例/纯理论），追加恰好 1 条 "
    "fit=not_recommended；判断不出就不要编造，省略这一条。\n"
    "3) 只输出 JSON 数组，不要外层包裹。"
)


def build_audience(payload: dict, dry_run: bool) -> list[dict]:
    """谁该看 → 结构化 {who,why,fit}[]。dry_run/stub 或输入过薄 → 空列表（页面走原句降级）。"""
    if _use_stub(dry_run):
        return []
    who = payload.get("whoShouldWatch")
    if not isinstance(who, str) or not who.strip():
        return []
    try:
        arr = _parse_json_array(_call(_AUDIENCE_SYS, json.dumps(payload, ensure_ascii=False)))
    except LLMError:
        return []
    out = []
    for a in arr:
        if not isinstance(a, dict):
            continue
        w = a.get("who")
        y = a.get("why")
        if not (isinstance(w, str) and w.strip() and isinstance(y, str) and y.strip()):
            continue
        fit = a.get("fit") if a.get("fit") in ("recommended", "not_recommended") else "recommended"
        out.append({"who": w.strip(), "why": y.strip(), "fit": fit})
    return out


# --- 关键帧视觉分类 ----------------------------------------------------

_FRAMES_SYS = (
    "你是大会视频截图分析器。给定一张 contact sheet（多帧拼图，行主序）与各帧时间戳，"
    "逐帧判断画面内容。严格要求：\n"
    "1) type 取值：slide(幻灯片) | chart(图表) | code(代码) | demo_ui(产品界面/演示) | "
    "speaker(只有讲者/舞台) | other。\n"
    "2) keep=true 仅当画面主体是**可读的屏幕内容**（幻灯片/图表/代码/产品界面）且值得作为配图；"
    "只有讲者、纯 logo、过场、模糊/黑帧一律 keep=false。\n"
    "3) caption 用中文一句话描述画面上的**具体内容**（<=20字），不要写「一张幻灯片」这种空话。\n"
    "4) 只输出 JSON 数组，元素 {\"t\":<秒>,\"type\":\"...\",\"keep\":true/false,\"caption\":\"...\"}。"
)


def classify_frames(sheet_path, timestamps: list[int], dry_run: bool) -> list[dict]:
    """contact sheet + 时间戳 → 逐帧分类。dry_run/stub → 全部不保留。"""
    if _use_stub(dry_run):
        return [{"t": t, "type": "other", "keep": False, "caption": ""} for t in timestamps]
    user = (
        f"Read the image at {sheet_path} — 它是 {len(timestamps)} 帧的 contact sheet，"
        f"行主序，对应时间戳(秒)：{timestamps}。逐帧输出。"
    )
    try:
        arr = _parse_json_array(_call(_FRAMES_SYS, user, max_turns=6))
    except LLMError:
        return [{"t": t, "type": "other", "keep": False, "caption": ""} for t in timestamps]

    by_t = {a.get("t"): a for a in arr if isinstance(a, dict)}
    out = []
    for t in timestamps:
        a = by_t.get(t, {})
        out.append({
            "t": t,
            "type": a.get("type") if a.get("type") in
            ("slide", "chart", "code", "demo_ui", "speaker", "other") else "other",
            "keep": a.get("keep") is True,
            "caption": (a.get("caption") or "").strip()[:40],
        })
    return out


# --- 会议级信号聚合 ----------------------------------------------------

_DIGEST_SYS = (
    "你是技术媒体主编。给定一场大会全部演讲的钩子与关键观点(带时间戳)，横切出这届大会的"
    "【信号】——不是逐场复述，而是跨场归纳出「这个领域正在发生什么」。目标读者是想快速搞懂"
    "AI 走向的从业者，3 分钟读完就拿到整届大会的 payload。\n"
    "严格要求：\n"
    "1) 每条信号必须来自输入的观点，sources 只能引用给定的 videoId 与其观点的 timestampSeconds，"
    "不得编造 id/时间/数字。\n"
    "2) 信号要具体、带数字或专有名词，避免「AI 很重要」这类空话。优先跨场共振的主题。\n"
    "3) 5-7 条，按重要性排序。\n"
    "4) 只输出 JSON：{\"headline\":\"一句话定调(<=30字)\",\"narrative\":\"2-3句说清这届大会的整体走向\","
    "\"signals\":[{\"title\":\"<=12字短标题\",\"statement\":\"信号本身，一句话，带具体数字/名词\","
    "\"whyItMatters\":\"为什么重要/意味着什么(1-2句)\","
    "\"sources\":[{\"videoId\":\"...\",\"timestampSeconds\":123}]}]}"
)


def build_digest(payload: dict, dry_run: bool) -> dict | None:
    """全会议观点 → 信号聚合。dry_run/stub → None（页面走降级不展示）。"""
    if _use_stub(dry_run):
        return None
    try:
        out = _parse_json(_call(_DIGEST_SYS, json.dumps(payload, ensure_ascii=False), max_tokens=8192))
    except LLMError:
        return None
    if not isinstance(out.get("signals"), list) or not out["signals"]:
        return None
    out.setdefault("headline", "")
    out.setdefault("narrative", "")
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


# --- 英文渲染（保结构原生二次提取）---------------------------------------
#
# 不是「中译英」。源转录本来就是英文，中文稿已是离原话一跳的产物；若再中译英
# 就成了 英→中→英 的往返，讲者的原创措辞会被磨掉（"token-maxing" 往返后
# 可能变成 "how many tokens are burned"）。
#
# 故这里让模型**读英文原句**重写英文散文，但**锁死中文版已有的骨架**
# （条目数量、顺序、时间戳、evidenceSegmentIds、看/略/听模式均不变）。
# 好处：英文原汁原味，且中英结构严格对齐——切换语言落到同一段、同一时刻、
# 同一批关键画面；frames 与 mustWatch 的绑定也不会错位。

_RENDER_EN_SYS = (
    "You produce the English version of a Chinese conference-talk guide.\n"
    "Each item is a group of related fields that share one transcript excerpt. "
    "`zh` maps field name -> existing Chinese text. Return the SAME field names.\n"
    "Each item has a `mode`:\n"
    "- mode=\"ground\": you also get `source` — verbatim English transcript of that exact "
    "moment. Write the English FROM `source`, preferring the speaker's own wording and "
    "coinages verbatim. Do NOT translate the Chinese literally: it is already one hop "
    "from the original, and a round trip would erase the speaker's phrasing. Keep the "
    "same meaning, scope and length band as each Chinese field; add no claim that is "
    "absent from `source`. If `source` genuinely cannot support a field, omit that "
    "field — never invent.\n"
    "- mode=\"translate\": there is no transcript source (these describe on-screen "
    "images, not speech). Render the Chinese faithfully into natural English. Always "
    "produce text for every field in these items.\n"
    "Always:\n"
    "1) Natural English typography: straight quotes, no full-width punctuation.\n"
    "2) Keep product/company/technical names as-is (Figma, Cursor, agent, token, evals).\n"
    "3) Return ONLY a JSON array, one element per input item, same order and count, "
    "and DO NOT omit any item: [{\"i\":<input i>,\"en\":{\"<field>\":\"...\"}}]"
)

# 每批组数。分组后每场约 19–22 组，设 25 可让绝大多数场次**一批跑完**——
# 每多一批就多一次 claude -p 往返（实测每次约 90s），批次数是总耗时的主因。
# claude -p 后端不接受 max_tokens，输出长度不可控，靠补漏重试兜底。
RENDER_EN_BATCH = 25


def _render_en_pass(items: list[dict], indices: list[int], out: list[dict]) -> None:
    """对 indices 指向的组跑一遍渲染，把拿到的字段并进 out（就地，不覆盖已有）。"""
    for base in range(0, len(indices), RENDER_EN_BATCH):
        batch = indices[base:base + RENDER_EN_BATCH]
        payload = []
        for pos, idx in enumerate(batch):
            it = items[idx]
            src = it.get("source") or ""
            # 只送本组仍缺的字段——补漏轮不必重译已成功的。
            need = {k: v for k, v in (it.get("zh") or {}).items() if k not in out[idx]}
            if not need:
                continue
            entry = {"i": pos, "mode": "ground" if src else "translate", "zh": need}
            if src:
                entry["source"] = src
            payload.append(entry)
        if not payload:
            continue
        try:
            arr = _parse_json_array(_call(_RENDER_EN_SYS, json.dumps(payload, ensure_ascii=False)))
        except LLMError as e:
            print(f"  [render-en] 一批失败，该批回落中文：{str(e)[:80]}")
            continue
        for item in arr:
            if not (isinstance(item, dict) and isinstance(item.get("i"), int)):
                continue
            pos = item["i"]
            en = item.get("en")
            if not (0 <= pos < len(batch)) or not isinstance(en, dict):
                continue
            target = out[batch[pos]]
            for k, v in en.items():
                if isinstance(v, str) and v.strip() and k in (items[batch[pos]].get("zh") or {}):
                    target[k] = v.strip()


def render_en_batch(items: list[dict], dry_run: bool) -> list[dict]:
    """把 [{zh:{字段:中文}, source}] 批量渲染成英文，返回等长的 [{字段:英文}]。

    对齐纪律沿用 translate_batch：按 i 配对、字段名回显配对，缺失的字段不出现在
    结果里，上层据此逐字段回落中文——不编造、不错位、单批失败不影响其余批次。

    实测模型会静默漏条（claude -p 不接受 max_tokens，输出长度不可控），故做一轮
    补漏重试：只把首轮没拿到的字段再送一次。仍拿不到的才回落中文。
    """
    if _use_stub(dry_run) or not items:
        return [{} for _ in items]

    out: list[dict] = [{} for _ in items]
    _render_en_pass(items, list(range(len(items))), out)

    def missing_count() -> int:
        return sum(len(set(it.get("zh") or {}) - set(o)) for it, o in zip(items, out))

    if missing_count():
        print(f"  [render-en] 首轮漏 {missing_count()} 个字段，补漏重试")
        incomplete = [i for i, (it, o) in enumerate(zip(items, out))
                      if set(it.get("zh") or {}) - set(o)]
        _render_en_pass(items, incomplete, out)

    still = missing_count()
    if still:
        print(f"  [render-en] 仍有 {still} 个字段未渲染，回落中文")
    return out
