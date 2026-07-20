# -*- coding: utf-8 -*-
"""关键帧留存：在「值得看画面」的时刻抽帧 → 视觉分类 → 只保留可读的屏幕内容。

动机：站点全是文字，缺少画面既不可信也不好传播。而演示/幻灯片这类画面本身
就是内容——把它们截下来留存，比让读者自己去视频里翻要有用得多。

流程：候选时刻(视觉时刻 + 必看片段 + 视觉依赖章节) → 原生 ffmpeg 抽帧 →
拼图一次调 claude -p 视觉分类 → keep=true 的落到 public/frames/<videoId>/。
只有讲者/黑帧/过场一律丢弃，不留噪声图。
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from . import config, llm

# 每场最多留存的候选帧数（拼图一次分类；超出按优先级截断）。
MAX_CANDIDATES = 15
# 候选去重：相邻时刻小于此秒数视为同一处画面。
DEDUP_SECONDS = 8
# 每个候选时刻额外采样的偏移（秒）：镜头切到屏幕的时机与转写时刻不同步，
# 多采几个让分类器从中挑到真正拍到屏幕的那一帧。
OFFSETS = (0, 12, -8)
PUBLIC_FRAMES_DIR = config.ROOT / "public" / "frames"


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def select_candidates(visual: dict, tour: dict | None, chapters: list[dict]) -> list[int]:
    """挑选候选抽帧时刻，按「越可能有可读屏幕内容」排序后去重截断。

    优先级：必看片段(编辑判定最有价值) > LLM 判定的视觉时刻 > 视觉依赖章节中点 > 关键词时刻。
    """
    scored: list[tuple[int, int]] = []  # (priority, seconds) —— priority 越小越优先
    def add(prio: int, base: float) -> None:
        for off in OFFSETS:
            t = int(base) + off
            if t > 0:
                scored.append((prio, t))

    for m in (tour or {}).get("mustWatch", []):
        s = m.get("startSeconds")
        if isinstance(s, (int, float)):
            add(0, s + 8)  # 片段起点常是过渡，往后挪一点
    for m in (visual or {}).get("moments", []):
        s = m.get("timestampSeconds")
        if isinstance(s, (int, float)):
            add(1 if m.get("source") == "llm" else 3, s + 3)
    for c in chapters or []:
        if c.get("visualDependency"):
            add(2, (c.get("startSeconds", 0) + c.get("endSeconds", 0)) / 2)

    scored.sort(key=lambda x: (x[0], x[1]))
    picked: list[int] = []
    for _, sec in scored:
        if sec <= 0:
            continue
        if any(abs(sec - p) < DEDUP_SECONDS for p in picked):
            continue
        picked.append(sec)
        if len(picked) >= MAX_CANDIDATES:
            break
    return sorted(picked)


def extract_frames(video_path, seconds: list[int], work: Path) -> list[tuple[int, Path]]:
    """原生 ffmpeg 按秒抽帧（缩放到 960 宽，够清晰也够小）。"""
    out_dir = work / "frames_raw"
    out_dir.mkdir(parents=True, exist_ok=True)
    got = []
    for sec in seconds:
        dst = out_dir / f"t{sec}.jpg"
        proc = _run([
            "ffmpeg", "-y", "-loglevel", "error", "-ss", str(sec), "-i", str(video_path),
            "-frames:v", "1", "-vf", "scale=960:-1", "-q:v", "4", str(dst),
        ])
        if proc.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            got.append((sec, dst))
    return got


def build_sheet(frames: list[tuple[int, Path]], work: Path) -> Path | None:
    """把候选帧拼成 contact sheet（一次调用分类全部，省 claude -p 开销）。"""
    if not frames:
        return None
    tmp = work / "sheet_src"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    for i, (_, p) in enumerate(frames):
        shutil.copyfile(p, tmp / f"s_{i:02d}.jpg")
    cols = 3
    rows = (len(frames) + cols - 1) // cols
    sheet = work / "frames_sheet.jpg"
    proc = _run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp / "s_%02d.jpg"),
        "-filter_complex", f"scale=640:-1,tile={cols}x{rows}:margin=4:padding=4", str(sheet),
    ])
    return sheet if proc.returncode == 0 and sheet.exists() else None


def collect_frames(
    video_id: str, media_path, visual: dict, tour: dict | None, chapters: list[dict], work: Path,
    dry_run: bool,
) -> list[dict]:
    """产出该场的留存关键帧记录（已写入 public/frames/<videoId>/）。"""
    if not media_path:
        return []
    candidates = select_candidates(visual, tour, chapters)
    if not candidates:
        return []

    frames = extract_frames(media_path, candidates, work)
    if not frames:
        return []
    sheet = build_sheet(frames, work)
    if not sheet:
        return []

    verdicts = llm.classify_frames(sheet, [s for s, _ in frames], dry_run)
    by_t = {v["t"]: v for v in verdicts}

    dest_dir = PUBLIC_FRAMES_DIR / video_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    # 重跑时先清旧图，避免残留已不再选中的帧
    for old in dest_dir.glob("*.jpg"):
        old.unlink()

    kept = []
    for sec, path in frames:
        v = by_t.get(sec)
        if not v or not v.get("keep"):
            continue
        name = f"t{sec}.jpg"
        shutil.copyfile(path, dest_dir / name)
        kept.append({
            "timestampSeconds": sec,
            "src": f"/frames/{video_id}/{name}",
            "kind": v.get("type"),
            "caption": v.get("caption") or "",
        })
    print(f"  [frames] {video_id}: 候选 {len(frames)} → 留存 {len(kept)}")
    return kept
