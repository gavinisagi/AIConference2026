# -*- coding: utf-8 -*-
"""英文版渲染：保结构的原生二次提取（非中译英）。

源转录本来就是英文，中文稿已是离原话一跳的产物。若做中译英就成了 英→中→英
的往返，讲者的原创措辞会被磨掉。故这里给模型的是**英文原句**，让它重写英文，
但锁死中文版已有的骨架（条目数、顺序、时间戳、模式、evidenceSegmentIds 不变）。

结果：英文原汁原味，且中英结构严格对齐——切换语言落在同一段、同一时刻、同一批
关键画面，frames 与 mustWatch 的绑定不会错位。

产物：data/i18n/en/<videoId>.json，形状与 enrichment 的散文字段一一对应。
与 enrichment 分开存放，故重跑 emit 不会冲掉英文稿。
"""
from __future__ import annotations

import json
from pathlib import Path

from . import config, llm

# 证据句是碎片化的 ASR 短句（"Why would it land there?"），单独喂给模型不足以
# 写出好散文，故取证据句前后各若干句作上下文窗口。
EVIDENCE_CONTEXT_BEFORE = 2
EVIDENCE_CONTEXT_AFTER = 3
# 单个 slot 的英文上下文上限（字符），防止长区间把 payload 撑爆。
MAX_SOURCE_CHARS = 1200


def _segments(asr: dict) -> list[dict]:
    return [s for s in (asr.get("segments") or []) if isinstance(s, dict)]


def _source_by_evidence(asr: dict, seg_ids: list[str] | None) -> str:
    """按 evidenceSegmentIds 取英文原句 + 前后上下文窗口。"""
    segs = _segments(asr)
    if not segs or not seg_ids:
        return ""
    index = {s.get("id"): i for i, s in enumerate(segs)}
    picked: set[int] = set()
    for sid in seg_ids:
        i = index.get(sid)
        if i is None:
            continue
        lo = max(0, i - EVIDENCE_CONTEXT_BEFORE)
        hi = min(len(segs), i + EVIDENCE_CONTEXT_AFTER + 1)
        picked.update(range(lo, hi))
    if not picked:
        return ""
    text = " ".join(segs[i].get("text", "").strip() for i in sorted(picked))
    return text[:MAX_SOURCE_CHARS].strip()


def _source_by_range(asr: dict, start: float | None, end: float | None) -> str:
    """按时间区间取连续英文转录（逐段导览用，材料比证据句更完整）。"""
    segs = _segments(asr)
    if not segs or start is None:
        return ""
    end = end if isinstance(end, (int, float)) and end > start else start + 60
    out: list[str] = []
    for s in segs:
        s_start = s.get("start")
        if not isinstance(s_start, (int, float)):
            continue
        if s_start < start:
            continue
        if s_start > end:
            break
        out.append(str(s.get("text", "")).strip())
    return " ".join(out)[:MAX_SOURCE_CHARS].strip()


def _group(prefix: list, obj: dict, keys: tuple[str, ...], source: str) -> dict | None:
    """把共享同一段英文源的若干字段打成一个渲染组。

    同一个 stop 的 title/what/keyPoint/howToReason 用的是同一段区间转录——
    拆成 4 个槽位会把同一段 source 重复发 4 次，既浪费 payload 也让条目数翻倍
    （条目越多模型越容易静默漏条）。故按条目分组，一次返回多个字段。
    """
    zh = {k: obj.get(k).strip() for k in keys
          if isinstance(obj.get(k), str) and obj.get(k).strip()}
    if not zh:
        return None
    return {"prefix": prefix, "zh": zh, "source": source}


def collect_slots(enrichment: dict, asr: dict) -> list[dict]:
    """把 enrichment 的散文字段按「共享英文源」分组，各组带上下文。

    prefix + zh 的键组成完整 path，用于回写时精确定位；
    顺序即 LLM 批次顺序（对齐靠 index）。
    """
    groups: list[dict] = []

    def add(g: dict | None) -> None:
        if g:
            groups.append(g)

    segs = _segments(asr)
    # 全片层面的判断（推荐语/钩子/谁该看/时间不够）共用开头转录做上下文。
    head = " ".join(s.get("text", "") for s in segs[:40])[:MAX_SOURCE_CHARS]
    tour = enrichment.get("tour") or {}
    add(_group(
        ["_top"],
        {"whyWatch": enrichment.get("whyWatch"),
         "hook": tour.get("hook"),
         "whoShouldWatch": tour.get("whoShouldWatch"),
         "ifShortOnTime": tour.get("ifShortOnTime")},
        ("whyWatch", "hook", "whoShouldWatch", "ifShortOnTime"),
        head,
    ))

    # audience 是重组产物、无直接原句，但仍在同一场演讲的语域内，用开头转录
    # 做上下文有助于措辞贴合讲者用语（同 _top 组）。
    for i, a in enumerate(tour.get("audience") or []):
        add(_group(["tour", "audience", i], a, ("who", "why"), head))

    for i, tk in enumerate(enrichment.get("takeaways") or []):
        add(_group(["takeaways", i], tk, ("statement", "context"),
                   _source_by_evidence(asr, tk.get("evidenceSegmentIds"))))

    for i, m in enumerate(tour.get("mustWatch") or []):
        add(_group(["tour", "mustWatch", i], m, ("label", "why"),
                   _source_by_range(asr, m.get("startSeconds"), m.get("endSeconds"))))

    for i, st in enumerate(tour.get("stops") or []):
        add(_group(["tour", "stops", i], st, ("title", "what", "keyPoint", "howToReason"),
                   _source_by_range(asr, st.get("startSeconds"), st.get("endSeconds"))))

    # 关键画面 caption 描述的是**画面**不是讲话，没有对应英文原句可依据；
    # source 留空走 translate 模式（图像描述的往返损耗极小）。多张合成一组。
    caps = {str(i): f.get("caption") for i, f in enumerate(enrichment.get("frames") or [])}
    add(_group(["frames"], caps, tuple(caps.keys()), ""))

    return groups


def build_en(video_id: str, enrichment: dict, asr: dict, dry_run: bool) -> dict:
    """渲染该场英文版散文，返回 {path 串: 英文} 的扁平映射。

    扁平映射（而非嵌套）让回写与消费都不必猜结构；build-data 侧按同样的
    path 规则取值。渲染失败或模型留空的槽位直接不出现在结果里，站点回落中文。
    """
    groups = collect_slots(enrichment, asr)
    if not groups:
        return {"videoId": video_id, "locale": "en", "fields": {}}

    rendered = llm.render_en_batch(
        [{"zh": g["zh"], "source": g["source"]} for g in groups], dry_run
    )

    def full_path(prefix: list, key: str) -> str:
        # _top 是虚拟前缀：whyWatch 在根，其余三个在 tour 下。
        if prefix == ["_top"]:
            return key if key == "whyWatch" else f"tour/{key}"
        if prefix == ["frames"]:
            return f"frames/{key}/caption"
        return "/".join(str(p) for p in prefix) + f"/{key}"

    fields: dict[str, str] = {}
    total = 0
    for group, en_map in zip(groups, rendered):
        total += len(group["zh"])
        if not isinstance(en_map, dict):
            continue
        for key in group["zh"]:
            val = en_map.get(key)
            if isinstance(val, str) and val.strip():
                fields[full_path(group["prefix"], key)] = val.strip()

    return {
        "videoId": video_id,
        "locale": "en",
        "renderedBy": {"pipeline": config.PIPELINE_VERSION, "backend": llm.resolve_backend()},
        "slotCount": total,
        "fields": fields,
    }


def write_en(video_id: str, payload: dict) -> Path:
    config.I18N_EN_DIR.mkdir(parents=True, exist_ok=True)
    path = config.I18N_EN_DIR / f"{video_id}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
