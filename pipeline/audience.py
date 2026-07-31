# -*- coding: utf-8 -*-
"""受众重组：把 tour 阶段的一句话「谁该看」重组成分角色的结构化列表，
并把过度宽松的 roles 多标签收紧成 1-2 个最贴切的。

不重新转录、不重新生成导览——只把已有的 whoShouldWatch/ifShortOnTime/
takeaways 喂给两次轻量 claude -p 调用，成本与 i18n_en 单场几个字段渲染同级。
见 pipeline/llm.py 的 build_audience / reclassify_roles。
"""
from __future__ import annotations

from . import llm


def generate_audience(tour: dict, draft: dict, dry_run: bool) -> dict:
    """产出 {"entries": [...], "roles": [...]}。

    entries 为空 → 页面走 whoShouldWatch 单句降级；roles 为空 → 调用方须回落
    draft 原有的 roles（reduce 阶段过度宽松但好过没有），不覆盖成空列表。
    """
    if not tour:
        return {"entries": [], "roles": []}
    payload = {
        "hook": tour.get("hook"),
        "whoShouldWatch": tour.get("whoShouldWatch"),
        "ifShortOnTime": tour.get("ifShortOnTime"),
        "takeaways": [
            {"statement": t.get("statement")} for t in (draft.get("takeaways") or [])
        ],
    }
    return {
        "entries": llm.build_audience(payload, dry_run),
        "roles": llm.reclassify_roles(payload, dry_run),
    }
