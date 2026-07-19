# -*- coding: utf-8 -*-
"""流水线配置：路径、版本、阈值、videoId 解析、catalog/媒体发现。

刻意零第三方依赖。所有可调参数集中在此，便于冻结版本（黄金集验收后）。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import __version__

# --- 路径 ---------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]           # 仓库根
DATA_DIR = ROOT / "data"
CATALOG_PATH = DATA_DIR / "catalog.json"
ENRICH_DIR = DATA_DIR / "enrichments"                # 产出目录（入库）
EDITORIAL_DIR = DATA_DIR / "editorial"

PIPELINE_DIR = ROOT / "pipeline"
WORK_DIR = PIPELINE_DIR / "work"                     # 每视频中间产物（gitignore）
ARTIFACTS_DIR = PIPELINE_DIR / "artifacts"           # 可选大产物（gitignore）
LOGS_DIR = PIPELINE_DIR / "logs"                     # 运行日志（gitignore）
STATE_DB = WORK_DIR / "state.sqlite"

CONTRACTS_DIR = PIPELINE_DIR / "contracts"
ASR_SCHEMA_PATH = CONTRACTS_DIR / "moss_asr_result.schema.json"

# --- 版本（冻结点）------------------------------------------------------
PIPELINE_VERSION = __version__
ENRICHMENT_SCHEMA_VERSION = 1

# --- ASR / 长视频切分阈值 ----------------------------------------------
# producer 单次可靠上限约 30min；留余量按 28min 判定是否切块。
SINGLE_PASS_MAX_SECONDS = 28 * 60
CHUNK_TARGET_SECONDS = 25 * 60          # 切块目标时长
CHUNK_OVERLAP_SECONDS = 12             # 相邻块重叠（跨块 speaker/去重用）

# --- 章节切分参数 -------------------------------------------------------
# utterance：相邻分段间静音 > 此值即断句边界（秒）。
UTTERANCE_GAP_SECONDS = 1.2
# chapter：语义块目标区间；超长静音或说话人切换优先成边界。
CHAPTER_MIN_SECONDS = 180
CHAPTER_MAX_SECONDS = 420
CHAPTER_BOUNDARY_GAP_SECONDS = 3.0      # 长停顿视为潜在章节边界

# --- 提炼 / 聚合 --------------------------------------------------------
MAX_TAKEAWAYS_PER_VIDEO = 8             # 全片 Reduce 后保留上限
MIN_TAKEAWAY_CONFIDENCE = 0.5          # 低于此置信度的 claim 不进 enrichment

# --- 说话人推断 --------------------------------------------------------
# 推断均带置信度与依据；仅高置信者投影到站点 speakers(其余留内部供人工审，不伪造)。
SPEAKER_MIN_CONFIDENCE = 0.6
SPEAKER_SAMPLE_SEGMENTS = 6            # 每个说话人取样分段数(优先自我介绍/交接句)

# --- 视觉时刻 ----------------------------------------------------------
MAX_VISUAL_MOMENTS = 20               # enrichment 里保留的抽帧建议上限

# --- LLM ----------------------------------------------------------------
LLM_MODEL = "claude-opus-4-8"
LLM_API_URL = "https://api.anthropic.com/v1/messages"
LLM_MAX_TOKENS = 4096
LLM_API_VERSION = "2023-06-01"

# --- 视觉触发关键词（命中即标记 chapter 需视觉证据）--------------------
VISUAL_TRIGGER_PHRASES = (
    "as you can see", "this chart", "this graph", "on this slide", "on the slide",
    "let me demo", "let me show", "take a look at", "over here", "on the screen",
    "this diagram", "如图", "这张图", "这页", "看这里", "演示一下",
)

# --- 三大会 source → conferenceId（与 build-data.mjs CONFERENCES 对齐）--
SOURCE_TO_CONFERENCE = {
    "ai_engineer_channel": "ai-engineer",
    "cursor_compile_2026": "cursor-compile",
    "figma_config_2026": "figma-config",
}

# 原始下载媒体目录（source key → data/<dir>/）。
MEDIA_DIRS = {
    "ai_engineer_channel": DATA_DIR / "ai_engineer_first_100",
    "cursor_compile_2026": DATA_DIR / "cursor_compile_2026",
    "figma_config_2026": DATA_DIR / "figma_config_2026",
}
VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".flv", ".wmv"}

_VIDEO_ID_RE = re.compile(r"\[([A-Za-z0-9_-]{6,})\]")


def parse_video_id(path: str | Path) -> str | None:
    """从 yt-dlp 文件名末尾 [VIDEOID] 解析 video_id（等于 catalog video_id）。"""
    m = _VIDEO_ID_RE.findall(Path(path).stem)
    return m[-1] if m else None


_catalog_cache: dict[str, dict] | None = None


def load_catalog() -> dict[str, dict]:
    """catalog.json → {video_id: record}。缓存。"""
    global _catalog_cache
    if _catalog_cache is None:
        records = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        _catalog_cache = {r["video_id"]: r for r in records if r.get("video_id")}
    return _catalog_cache


def find_media_file(video_id: str) -> Path | None:
    """在三个下载目录中按 [video_id] 定位本地媒体文件。"""
    for d in MEDIA_DIRS.values():
        if not d.exists():
            continue
        for p in d.iterdir():
            if p.suffix.lower() in VIDEO_EXTS and parse_video_id(p) == video_id:
                return p
    return None


def work_dir(video_id: str) -> Path:
    d = WORK_DIR / video_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def ensure_dirs() -> None:
    for d in (WORK_DIR, ARTIFACTS_DIR, LOGS_DIR, ENRICH_DIR):
        d.mkdir(parents=True, exist_ok=True)
