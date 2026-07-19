# -*- coding: utf-8 -*-
"""统一 ASR 结果的轻量校验器（对应 contracts/moss_asr_result.schema.json）。

手写而非引 jsonschema：形状固定、零依赖更稳。任何 provider 产出都必须过 validate()。
"""
from __future__ import annotations

import re

_SEG_ID_RE = re.compile(r"^seg_[0-9]{5,}$")
_SPEAKER_RE = re.compile(r"^S[0-9]{2,}$")
_PROVIDERS = {"moss-asr", "faster-whisper"}
_SCOPES = {"global", "chunk"}


class ASRValidationError(ValueError):
    pass


def validate(result: dict) -> dict:
    """校验统一 ASR 结果；通过则原样返回，否则抛 ASRValidationError（含定位）。"""
    errs: list[str] = []

    if result.get("schemaVersion") != 1:
        errs.append(f"schemaVersion 必须为 1，得到 {result.get('schemaVersion')!r}")

    src = result.get("source")
    if not isinstance(src, dict):
        errs.append("source 缺失或非对象")
    else:
        if not _nonempty_str(src.get("videoId")):
            errs.append("source.videoId 必须为非空字符串")
        if not _nonempty_str(src.get("inputPath")):
            errs.append("source.inputPath 必须为非空字符串")
        if not _pos_number(src.get("durationSeconds")):
            errs.append("source.durationSeconds 必须为正数")

    asr = result.get("asr")
    if not isinstance(asr, dict):
        errs.append("asr 缺失或非对象")
    else:
        if asr.get("provider") not in _PROVIDERS:
            errs.append(f"asr.provider 非法：{asr.get('provider')!r}")
        if not _nonempty_str(asr.get("model")):
            errs.append("asr.model 必须为非空字符串")
        if not _nonempty_str(asr.get("language")) or len(str(asr.get("language"))) < 2:
            errs.append("asr.language 必须为 ISO639-1（>=2 字符）")
        if asr.get("speakerScope") not in _SCOPES:
            errs.append(f"asr.speakerScope 非法：{asr.get('speakerScope')!r}")

    segs = result.get("segments")
    if not isinstance(segs, list):
        errs.append("segments 必须为数组")
    else:
        prev_start = -1.0
        seen_ids: set[str] = set()
        for i, s in enumerate(segs):
            at = f"segments[{i}]"
            if not isinstance(s, dict):
                errs.append(f"{at} 非对象")
                continue
            sid = s.get("id")
            if not (isinstance(sid, str) and _SEG_ID_RE.match(sid)):
                errs.append(f"{at}.id 须形如 seg_00001，得到 {sid!r}")
            elif sid in seen_ids:
                errs.append(f"{at}.id 重复：{sid}")
            else:
                seen_ids.add(sid)
            st, en = s.get("start"), s.get("end")
            if not _nonneg_number(st):
                errs.append(f"{at}.start 须为非负数")
            if not _nonneg_number(en):
                errs.append(f"{at}.end 须为非负数")
            if _nonneg_number(st) and _nonneg_number(en) and en < st:
                errs.append(f"{at}.end({en}) < start({st})")
            if _nonneg_number(st):
                if st < prev_start - 1e-6:
                    errs.append(f"{at}.start({st}) 逆序（前一段 {prev_start}）")
                prev_start = st
            spk = s.get("speaker")
            if not (isinstance(spk, str) and _SPEAKER_RE.match(spk)):
                errs.append(f"{at}.speaker 须形如 S01，得到 {spk!r}")
            if not isinstance(s.get("text"), str):
                errs.append(f"{at}.text 必须为字符串")

    if errs:
        raise ASRValidationError("统一 ASR 结果校验失败：\n  - " + "\n  - ".join(errs[:25]))
    return result


def _nonempty_str(v) -> bool:
    return isinstance(v, str) and len(v) > 0


def _pos_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0


def _nonneg_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0
