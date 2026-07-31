# -*- coding: utf-8 -*-
"""受众重组：把 tour 阶段的一句话「谁该看」重组成分角色的结构化列表。

不重新转录、不重新生成导览——只把已有的 whoShouldWatch/ifShortOnTime/
takeaways 喂给一次轻量 claude -p 调用，成本与 i18n_en 单场几个字段渲染同级。
见 pipeline/llm.py 的 build_audience。
"""
from __future__ import annotations

from . import llm


def generate_audience(tour: dict, draft: dict, dry_run: bool) -> list[dict]:
    """产出 audience 列表；tour 缺失或 whoShouldWatch 为空 → 空列表（页面走原句降级）。"""
    if not tour:
        return []
    payload = {
        "hook": tour.get("hook"),
        "whoShouldWatch": tour.get("whoShouldWatch"),
        "ifShortOnTime": tour.get("ifShortOnTime"),
        "takeaways": [
            {"statement": t.get("statement")} for t in (draft.get("takeaways") or [])
        ],
    }
    return llm.build_audience(payload, dry_run)
