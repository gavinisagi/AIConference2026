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

from . import config, emit, llm, media, qc, segment, state, subtitle, transcribe, visual


def _load(work: Path, name: str):
    p = work / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def _dump(work: Path, name: str, obj) -> None:
    (work / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def run_video(video_id: str, args) -> bool:
    config.ensure_dirs()
    work = config.work_dir(video_id)
    backend = llm.resolve_backend()
    dry = args.dry_run or backend == "stub"
    if not args.dry_run:
        if backend == "stub":
            print(f"[{video_id}] 无 claude CLI / API key → LLM 走桩（--dry-run 效果）")
        else:
            print(f"[{video_id}] LLM 后端：{backend}")

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

    # 4) extract（章节级 LLM 提炼；整场一次批量调用，省 claude -p 开销）
    def _extract():
        _dump(work, "extracts.json", llm.extract_chapters_batched(chapters, dry))
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

    # 5b) speaker（说话人身份推断，带置信度与依据）
    def _speaker():
        title = config.load_catalog().get(video_id, {}).get("title", "")
        _dump(work, "speakers.json", llm.infer_speakers(asr, title, dry))
    if not stage("speaker", _speaker):
        return False
    speakers = _load(work, "speakers.json")

    # 6) visual（按需视觉：段级抽帧时刻 + 章节计划 + 执行/桩）
    def _visual():
        moments = visual.find_visual_moments(asr, extracts, segment.segment_index(asr))
        plan = visual.plan_visual(chapters, extracts)
        _dump(work, "visual.json", {
            "moments": moments,
            "chapterPlan": visual.run_visual(media_path, plan, dry),
        })
    if not stage("visual", _visual):
        return False
    visual_out = _load(work, "visual.json")

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

    # 章节标题由 extract 阶段的 chapterTitle 回写（供视频导览）。
    titles = {ex.get("chapterIndex", i): ex.get("chapterTitle") for i, ex in enumerate(extracts)}
    titled_chapters = [{**c, "title": titles.get(c["index"]) or c["title"]} for c in chapters]

    # 8) emit（投影 → data/enrichments/<id>.json）
    def _emit():
        enrichment = emit.build_enrichment(
            video_id, draft, seg_index, asr, titled_chapters, dry,
            speakers=speakers, visual=visual_out,
        )
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


def cmd_review(args) -> int:
    """人工审核辅助：把每条 takeaway 与其引用的原始转写证据并排列出，便于核对出处。

    不带 video_id → 全部已清洗视频的审核概览（takeaway 数 / qc 标记 / whyWatch）。
    """
    if not args.video_id:
        return _review_summary(args)
    vid = args.video_id
    enrich_path = config.ENRICH_DIR / f"{vid}.json"
    if not enrich_path.exists():
        print(f"无 enrichment：{enrich_path}", file=sys.stderr)
        return 1
    e = json.loads(enrich_path.read_text(encoding="utf-8"))
    work = config.WORK_DIR / vid
    asr = _load(work, "asr.json")
    seg_index = {s["id"]: s for s in asr["segments"]} if asr else {}
    qc_issues = _load(work, "qc.json") or []
    title = config.load_catalog().get(vid, {}).get("title", "")

    def fmt_t(sec):
        if sec is None:
            return "—"
        m, s = divmod(int(sec), 60)
        return f"{m}:{s:02d}"

    print(f"\n{'=' * 72}")
    print(f"{vid}  {title}")
    print(f"{'=' * 72}")
    print(f"后端: {e['generatedBy'].get('asrProvider')} / {e['generatedBy'].get('llmModel')}"
          f"  语言: {e.get('language')}  章节: {len(e.get('chapters', []))}")
    print(f"topics: {e.get('topics')}   roles: {e.get('roles')}")
    print(f"whyWatch: {e.get('whyWatch')}")
    if qc_issues:
        print("\n⚠ 质检标记（需重点核对）:")
        for it in qc_issues:
            print(f"  [{it['level']}] {it['code']}: {it['msg']}")

    inferences = e.get("speakerInferences", [])
    if inferences:
        print("\n说话人推断（★=已上站；其余置信不足，仅供审核，不伪造）:")
        proj = {(s["name"], s.get("org")) for s in e.get("speakers", [])}
        for sp in inferences:
            star = "★" if (sp.get("name"), sp.get("org")) in proj else " "
            who = sp.get("name") or "（未能确定）"
            org = f" @ {sp['org']}" if sp.get("org") else ""
            print(f"  {star}{sp['speaker']}: {who}{org}  conf={sp.get('confidence')}")
            if sp.get("basis"):
                print(f"      依据: {sp['basis']}")

    vm = e.get("visualMoments", [])
    if vm:
        n_llm = sum(1 for m in vm if m.get("source") == "llm")
        print(f"\n值得抽帧看图像的时刻（{len(vm)} 处，LLM判定 {n_llm} + 关键词 {len(vm) - n_llm}）:")
        for m in vm:
            mm, ss = divmod(int(m["timestampSeconds"]), 60)
            tag = "★LLM" if m.get("source") == "llm" else "kw"
            detail = m.get("reason") or f"[{m.get('trigger')}] {m.get('quote', '')}"
            print(f"  {mm}:{ss:02d} ?t={int(m['timestampSeconds'])} ({tag}) {detail[:80]}")

    print(f"\ntakeaways（{len(e.get('takeaways', []))} 条，观点 ← 原始转写证据）:")
    for i, tk in enumerate(e.get("takeaways", [])):
        print(f"\n  [{i}] t={fmt_t(tk.get('timestampSeconds'))} "
              f"conf={tk.get('confidence')} 深链 ?t={int(tk['timestampSeconds']) if tk.get('timestampSeconds') is not None else '?'}")
        print(f"      观点: {tk['statement']}")
        ev = tk.get("evidenceSegmentIds", [])
        if seg_index:
            # 按时间排序展示，使深链 ?t=（取证据最早 start）与首条证据对齐。
            ev_segs = sorted(
                (seg_index[e] for e in ev if e in seg_index), key=lambda s: s["start"]
            )
            for seg in ev_segs[: args.max_evidence]:
                print(f"      └ {seg['id']}@{fmt_t(seg['start'])} {seg['speaker']}: {seg['text'][:100]}")
            if len(ev_segs) > args.max_evidence:
                print(f"      └ …另 {len(ev_segs) - args.max_evidence} 段证据")
        else:
            print(f"      └ 证据段: {ev}（work/{vid}/asr.json 已清，无法展开原文）")
    print()
    return 0


def _review_summary(args) -> int:
    """全部已清洗视频的审核概览，突出有 qc 标记、需重点审的条目。"""
    files = sorted(config.ENRICH_DIR.glob("*.json"))
    if not files:
        print("（data/enrichments/ 下暂无清洗产物）")
        return 0
    catalog = config.load_catalog()
    print(f"{'videoId':<14} {'tk':>3} {'qc(e/w)':>8} {'why':>4}  标题")
    print("-" * 76)
    flagged = 0
    for f in files:
        e = json.loads(f.read_text(encoding="utf-8"))
        vid = e["videoId"]
        qc_issues = _load(config.WORK_DIR / vid, "qc.json") or []
        errs = sum(1 for x in qc_issues if x["level"] == "error")
        warns = sum(1 for x in qc_issues if x["level"] == "warn")
        if errs or warns:
            flagged += 1
        why = "是" if e.get("whyWatch") else "—"
        title = catalog.get(vid, {}).get("title", "")[:34]
        mark = "⚠" if (errs or warns) else " "
        print(f"{mark}{vid:<13} {len(e.get('takeaways', [])):>3} {f'{errs}/{warns}':>8} {why:>4}  {title}")
    print("-" * 76)
    print(f"共 {len(files)} 条，{flagged} 条有 qc 标记（⚠，`review <id>` 展开核对）")
    return 0


def cmd_subtitle(args) -> int:
    """从已转写的 asr.json 导出字幕（en / zh / bi 双语）。"""
    vid = args.video_id
    work = config.WORK_DIR / vid
    asr = _load(work, "asr.json")
    if not asr:
        print(f"无 asr.json（先跑 transcribe）：{work/'asr.json'}", file=sys.stderr)
        return 1
    # 默认写到视频旁边同名（播放器自动加载）；无本地视频则写到 work 目录。
    media_path = args.media or config.find_media_file(vid)
    if media_path:
        media_path = Path(media_path)
        out_dir, basename = media_path.parent, media_path.stem
    else:
        out_dir, basename = work, vid
    dry = args.dry_run or llm.resolve_backend() == "stub"
    written = subtitle.export(
        asr, out_dir, basename, langs=tuple(args.langs.split(",")),
        fmt=args.format, speaker=args.speaker, dry_run=dry,
        cache_path=work / "translations.json",
    )
    for p in written:
        print(f"  写出 {p}")
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

    rv = sub.add_parser("review", help="人工审核：观点 ← 原始转写证据 并排展示（无 id 出概览）")
    rv.add_argument("video_id", nargs="?")
    rv.add_argument("--max-evidence", type=int, default=3, help="每条 takeaway 展开的证据段数上限")
    rv.set_defaults(func=cmd_review)

    sb = sub.add_parser("subtitle", help="从 asr.json 导出字幕(en/zh/bi 双语)，写到视频旁同名")
    sb.add_argument("video_id")
    sb.add_argument("--langs", default="en,bi", help="逗号分隔子集 of en,zh,bi（bi=中英双语）")
    sb.add_argument("--format", default="srt", choices=["srt", "vtt"])
    sb.add_argument("--speaker", action="store_true", help="每行前缀说话人标签 [S0x]")
    sb.add_argument("--media", help="显式指定视频路径(决定字幕写到哪+同名)")
    sb.add_argument("--dry-run", action="store_true", help="不翻译，只出英文")
    sb.set_defaults(func=cmd_subtitle)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
