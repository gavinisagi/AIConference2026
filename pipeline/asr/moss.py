# -*- coding: utf-8 -*-
"""Moss ASR provider：按 contracts/moss-asr-contract.md 调用另一 session 部署的 CLI。

边界（见契约 §1）：本 provider 只把 ≤28min 的单文件交给 Moss CLI，拿回统一 schema JSON。
长视频切分、跨块拼接由 pipeline.stages.transcribe 负责，不在此。
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from .. import config
from . import schema

# Moss CLI 路径（另一 session 交付）。可用环境变量覆盖。
MOSS_DIR = Path(os.environ.get("MOSS_DIR", config.ROOT.parent / "mossASR"))
MOSS_CLI = MOSS_DIR / "scripts" / "moss_transcribe.py"
# 调 CLI 用的 python：优先 mossASR 自带 venv（Windows 布局），否则系统 python。
_MOSS_PY_CANDIDATES = [
    MOSS_DIR / "MOSS-Transcribe-Diarize" / ".venv" / "Scripts" / "python.exe",
    MOSS_DIR / "MOSS-Transcribe-Diarize" / ".venv" / "bin" / "python.exe",
]


def _moss_python() -> str:
    for c in _MOSS_PY_CANDIDATES:
        if c.exists():
            return str(c)
    return "python"


def available() -> bool:
    """CLI 是否已交付（另一 session 完成的信号）。"""
    return MOSS_CLI.exists()


class MossTimeout(RuntimeError):
    """Moss CLI 超时（vLLM 偶发卡顿）。上层据此重试。"""


def transcribe_file(
    input_path: str | Path, video_id: str, prompt: str | None = None, timeout: float | None = None,
) -> dict:
    """调 Moss CLI 转写单个 ≤28min 文件 → 统一 schema（已校验）。

    契约 §2：`moss_transcribe.py <INPUT> --out <OUT.json> [--video-id ID] [--prompt ...]`
    成功退出 0 + 写出满足 schema 的 JSON。

    timeout：超时（秒）。vLLM 偶发生成卡死（吞吐→0），无超时会吊死整批；
    超时抛 MossTimeout 让上层重试。None 时不限时。
    """
    if not available():
        raise RuntimeError(
            f"Moss CLI 未就绪：{MOSS_CLI} 不存在。"
            f"该部分由另一 session 按 mossASR/ASR_CONTRACT.md 交付。"
        )
    input_path = Path(input_path)
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / f"{video_id}.json"
        cmd = [_moss_python(), str(MOSS_CLI), str(input_path), "--out", str(out), "--video-id", video_id]
        if prompt:
            cmd += ["--prompt", prompt]
        try:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8", timeout=timeout,
            )
        except subprocess.TimeoutExpired as e:
            raise MossTimeout(f"Moss CLI 超时（>{timeout:.0f}s，vLLM 疑似卡顿）") from e
        if proc.returncode != 0:
            raise RuntimeError(
                f"Moss CLI 失败（exit {proc.returncode}）：\n{proc.stderr[-1000:]}"
            )
        if not out.exists():
            raise RuntimeError(f"Moss CLI 退出 0 但未写出 {out}")
        result = json.loads(out.read_text(encoding="utf-8"))
    return schema.validate(result)
