# -*- coding: utf-8 -*-
"""自动质检（Codex 方案 §5）：enrichment 上站前的机器检查。

返回 issue 列表，每条 {level: error|warn, code, msg}。error 阻断 emit（除非 --force）。
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


# 非英语（拉丁文）高信号功能词——用于探测 Moss 在英文音频上偶发的语言幻觉。
# 均为在英文里几乎不出现的整词，降低误报。
_NON_EN_MARKERS = {
    "che", "sono", "quindi", "alcune", "della", "perché", "questo", "molto",  # it
    "pero", "porque", "también", "entonces", "estos", "está", "hacer",        # es
    "aber", "nicht", "sich", "auch", "sehr", "diese", "weil",                  # de
    "mais", "parce", "cette", "aussi", "très", "être",                          # fr
}
_WORD_RE = re.compile(r"[a-zà-ÿ]+", re.IGNORECASE)


def _language_anomaly(asr_result: dict) -> list[dict]:
    """探测与主语言不一致的分段（ASR 语言幻觉），仅对 language=en 生效。返回 warn。"""
    if asr_result["asr"].get("language") != "en":
        return []
    flagged = []
    for s in asr_result["segments"]:
        words = {w.lower() for w in _WORD_RE.findall(s.get("text", ""))}
        hits = words & _NON_EN_MARKERS
        if len(hits) >= 2:
            flagged.append((s["id"], s["start"], sorted(hits)))
    if len(flagged) < 3:
        return []
    sample = "; ".join(f"{sid}@{st:.0f}s({'/'.join(h)})" for sid, st, h in flagged[:4])
    return [{
        "level": "warn",
        "code": "asr-lang-anomaly",
        "msg": f"{len(flagged)} 段疑似非英语（Moss 语言幻觉，需人工核对）：{sample}",
    }]


def check(asr_result: dict, seg_index: dict, draft: dict, duration: float) -> list[dict]:
    issues: list[dict] = []

    def err(code, msg):
        issues.append({"level": "error", "code": code, "msg": msg})

    def warn(code, msg):
        issues.append({"level": "warn", "code": code, "msg": msg})

    takeaways = draft.get("takeaways", [])

    # 1) 每条 takeaway 必须有真实证据 segment，且时间戳落在时长内。
    for i, tk in enumerate(takeaways):
        ev = tk.get("evidenceSegmentIds", [])
        real = [e for e in ev if e in seg_index]
        if not real:
            err("no-evidence", f"takeaway[{i}] 无有效证据 segment：{ev}")
            continue
        ts = min(seg_index[e]["start"] for e in real)
        if ts < 0 or ts > duration + 1:
            err("ts-out-of-range", f"takeaway[{i}] 时间戳 {ts:.1f}s 超出时长 {duration:.1f}s")

    # 2) takeaways 之间不应高度重复。
    for i in range(len(takeaways)):
        for j in range(i + 1, len(takeaways)):
            si, sj = takeaways[i].get("statement", ""), takeaways[j].get("statement", "")
            if si and sj and _similar(si, sj) > 0.85:
                warn("dup-takeaway", f"takeaway[{i}] 与 [{j}] 高度相似（>0.85）")

    # 3) whyWatch 不得引入正文不存在的空泛结论（弱检查：非空即要求有 takeaways 支撑）。
    if draft.get("whyWatch") and not takeaways:
        warn("whyWatch-unsupported", "有 whyWatch 但无 takeaways 支撑")

    # 4) ASR 覆盖率：长时间无转写覆盖 → 可疑。
    segs = asr_result["segments"]
    if segs:
        gaps = [
            (segs[k + 1]["start"] - segs[k]["end"], segs[k]["end"])
            for k in range(len(segs) - 1)
        ]
        big = [(g, at) for g, at in gaps if g > 60]
        for g, at in big[:5]:
            warn("asr-gap", f"{at:.0f}s 处有 {g:.0f}s 无转写覆盖")
    else:
        err("asr-empty", "ASR 无任何分段")

    # 5) ASR 异常重复（同文本连续多次）。
    reps = 0
    for k in range(1, len(segs)):
        if segs[k]["text"].strip() and segs[k]["text"].strip() == segs[k - 1]["text"].strip():
            reps += 1
    if reps > 3:
        warn("asr-repeat", f"检测到 {reps} 处相邻重复文本（可能幻觉/卡死）")

    # 5b) ASR 语言幻觉（英文音频里冒出非英语段）。
    issues.extend(_language_anomaly(asr_result))

    # 6) 深链可生成（时间戳为非负数）。
    for i, tk in enumerate(takeaways):
        ev = [e for e in tk.get("evidenceSegmentIds", []) if e in seg_index]
        if ev and seg_index[ev[0]]["start"] < 0:
            err("bad-deeplink", f"takeaway[{i}] 无法生成 ?t= 深链")

    return issues


def has_errors(issues: list[dict]) -> bool:
    return any(x["level"] == "error" for x in issues)
