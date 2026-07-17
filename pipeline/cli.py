# -*- coding: utf-8 -*-
"""流水线编排器 CLI。

用法：
  python -m pipeline.cli run <videoId> [--from-moss-result PATH] [--dry-run] [--force] [--media PATH]
  python -m pipeline.cli run --all [--dry-run] [--force]
  python -m pipeline.cli status [videoId]
  python -m pipeline.cli reset <videoId> [--stage STAGE]

每阶段独立落盘于 pipeline/work/<videoId>/，状态入 SQLite。失败只重跑失败阶段。
--dry-run（或无 ANTHROPIC_API_KEY）：LLM 走确定性桩，管道端到端可跑。
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

# Windows 控制台默认 gbk 存不下 ✓/→/CJK，统一转 UTF-8（不可编码字符降级替换）。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure") and (_stream.encoding or "").lower() != "utf-8":
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass

from . import config, emit, llm, media, qc, segment, state, transcribe, visual


def _load(work: Path, name: str):
    p = work / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _dump(work: Path, name: str, obj) -> None:
    (work / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def run_video(video_id: str, args) -> bool:
    config.ensure_dirs()
    work = config.work_dir(video_id)
    dry = args.dry_run or not llm.has_api_key()
    if dry and not args.dry_run:
        print(f"[{video_id}] 无 ANTHROPIC_API_KEY → 自动 --dry-run（LLM 走桩）")

    media_path = args.media or (str(config.find_media_file(video_id) or "") or None)

    def stage(name, fn):
        """执行单阶段：已成功且非 force 则跳过；异常记 failed 并中断。"""
        if state.get_status(video_id, name) == state.SUCCEEDED and not args.force:
            print(f"[{video_id}] {name}: 跳过（已成功）")
            return True
        state.set_status(video_id, name, state.RUNNING)
        try:
            fn()
            state.set_status(video_id, name, state.SUCCEEDED)
            print(f"[{video_id}] {name}: ok")
            return True
        except Exception as e:  # noqa: BLE001 — 阶段级隔离，单阶段失败不崩整批
            state.set_status(video_id, name, state.FAILED, error=str(e))
            print(f"[{video_id}] {name}: FAILED — {e}", file=sys.stderr)
            if args.verbose:
                traceback.print_exc()
            return False

    # 1) probe（有本地媒体才做；仅 --from-moss-result 时可跳过）
    def _probe():
        if not media_path:
            _dump(work, "manifest.json", {"videoId": video_id, "note": "无本地媒体，probe 跳过"})
            return
        _dump(work, "manifest.json", media.probe(media_path, video_id))
    if not stage("probe", _probe):
        return False

    # 2) transcribe（ASR → 统一 schema）
    def _transcribe():
        asr = transcribe.transcribe_video(video_id, media_path, args.from_moss_result, work, dry)
        _dump(work, "asr.json", asr)
    if not stage("transcribe", _transcribe):
        return False

    asr = _load(work, "asr.json")

    # 3) segment（章节切分）
    def _segment():
        _dump(work, "chapters.json", segment.build_chapters(asr))
    if not stage("segment", _segment):
        return False
    chapters = _load(work, "chapters.json")

    # 4) extract（章节级 LLM 提炼）
    def _extract():
        _dump(work, "extracts.json", [llm.extract_chapter(c, dry) for c in chapters])
    if not stage("extract", _extract):
        return False
    extracts = _load(work, "extracts.json")

    # 5) aggregate（全片 Reduce）
    def _aggregate():
        title = config.load_catalog().get(video_id, {}).get("title", "")
        _dump(work, "draft.json", llm.reduce_video(extracts, title, dry))
    if not stage("aggregate", _aggregate):
        return False
    draft = _load(work, "draft.json")

    # 6) visual（按需视觉：计划 + 执行/桩）
    def _visual():
        plan = visual.plan_visual(chapters, extracts)
        _dump(work, "visual.json", visual.run_visual(media_path, plan, dry))
    if not stage("visual", _visual):
        return False

    # 7) qc（自动质检）
    seg_index = segment.segment_index(asr)
    duration = asr["source"]["durationSeconds"]

    def _qc():
        issues = qc.check(asr, seg_index, draft, duration)
        _dump(work, "qc.json", issues)
        for it in issues:
            print(f"[{video_id}] qc {it['level']}: {it['code']} — {it['msg']}")
        if qc.has_errors(issues) and not args.force:
            raise RuntimeError("质检存在 error（--force 可强制放行）")
    if not stage("qc", _qc):
        return False

    # 8) emit（投影 → data/enrichments/<id>.json）
    def _emit():
        enrichment = emit.build_enrichment(video_id, draft, seg_index, asr, chapters, dry)
        path = emit.write_enrichment(video_id, enrichment)
        print(f"[{video_id}] emit → {path}  ({len(enrichment['takeaways'])} takeaways)")
    if not stage("emit", _emit):
        return False

    print(f"[{video_id}] ✓ 完成")
    return True


def cmd_run(args) -> int:
    if args.all:
        ids = _discover_all()
        print(f"发现 {len(ids)} 场本地视频")
        ok = sum(run_video(v, args) for v in ids)
        print(f"完成 {ok}/{len(ids)}")
        return 0 if ok == len(ids) else 1
    if not args.video_id:
        print("需指定 <videoId> 或 --all", file=sys.stderr)
        return 2
    return 0 if run_video(args.video_id, args) else 1


def _discover_all() -> list[str]:
    ids = []
    for d in config.MEDIA_DIRS.values():
        if d.exists():
            for p in d.iterdir():
                if p.suffix.lower() in config.VIDEO_EXTS:
                    vid = config.parse_video_id(p)
                    if vid:
                        ids.append(vid)
    return sorted(set(ids))


def cmd_status(args) -> int:
    ids = [args.video_id] if args.video_id else state.all_video_ids()
    if not ids:
        print("（无记录）")
        return 0
    for vid in ids:
        st = state.video_stages(vid)
        line = "  ".join(f"{s}:{st[s]}" for s in state.STAGES)
        print(f"{vid}  {line}")
    return 0


def cmd_reset(args) -> int:
    state.reset(args.video_id, args.stage)
    print(f"已重置 {args.video_id}" + (f" 阶段 {args.stage}" if args.stage else ""))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pipeline.cli", description="视频清洗流水线")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="运行流水线")
    r.add_argument("video_id", nargs="?")
    r.add_argument("--all", action="store_true", help="处理所有本地视频")
    r.add_argument("--from-moss-result", help="用现有 mossASR/results/*.json 联调（跳过实时 ASR）")
    r.add_argument("--media", help="显式指定媒体文件路径")
    r.add_argument("--dry-run", action="store_true", help="LLM 走确定性桩")
    r.add_argument("--force", action="store_true", help="忽略已成功状态与 qc error，强制重跑/放行")
    r.add_argument("--verbose", action="store_true")
    r.set_defaults(func=cmd_run)

    s = sub.add_parser("status", help="查看阶段状态")
    s.add_argument("video_id", nargs="?")
    s.set_defaults(func=cmd_status)

    rs = sub.add_parser("reset", help="重置状态以便重跑")
    rs.add_argument("video_id")
    rs.add_argument("--stage", help="只重置某阶段")
    rs.set_defaults(func=cmd_reset)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
