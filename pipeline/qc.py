# -*- coding: utf-8 -*-
"""自动质检（Codex 方案 §5）：enrichment 上站前的机器检查。

返回 issue 列表，每条 {level: error|warn, code, msg}。error 阻断 emit（除非 --force）。
"""
from __future__ import annotations

from difflib import SequenceMatcher


def _similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


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

    # 6) 深链可生成（时间戳为非负数）。
    for i, tk in enumerate(takeaways):
        ev = [e for e in tk.get("evidenceSegmentIds", []) if e in seg_index]
        if ev and seg_index[ev[0]]["start"] < 0:
            err("bad-deeplink", f"takeaway[{i}] 无法生成 ?t= 深链")

    return issues


def has_errors(issues: list[dict]) -> bool:
    return any(x["level"] == "error" for x in issues)
