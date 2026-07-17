"""AI Conference 2026 — 视频清洗流水线（纯 Python 3.12 标准库）。

阶段：probe → transcribe(ASR) → segment → extract(LLM) → aggregate → visual → qc → emit。
每阶段独立落盘于 pipeline/work/<videoId>/，状态入 SQLite，失败只重跑失败阶段。
产出 data/enrichments/<videoId>.json，由 scripts/build-data.mjs 合并进站点。
契约见 pipeline/contracts/。
"""

__version__ = "0.1.0"
