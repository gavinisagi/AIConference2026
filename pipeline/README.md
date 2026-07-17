# pipeline — 视频清洗流水线

把下载好的大会视频清洗成**带时间戳和证据链的结构化观点**（`data/enrichments/<videoId>.json`），
由 `scripts/build-data.mjs` 合并进站点 `dataset.json`。纯 Python 3.12 标准库，零第三方依赖。

## 阶段（每步独立落盘 + 断点续跑）

```
probe → transcribe → segment → extract → aggregate → visual → qc → emit
 媒体    ASR统一      章节切分   章节LLM    全片Reduce  按需视觉  质检   产出
 探测    schema                 提炼       去重排序    触发                enrichment
```

- 中间产物落 `pipeline/work/<videoId>/`（gitignore），状态入 `pipeline/work/state.sqlite`。
- 失败只重跑失败阶段；已成功阶段默认跳过（`--force` 强制重跑）。
- **时间戳由程序据 `evidenceSegmentIds` 反查计算，不采信 LLM 猜的时间。**

## 用法

```sh
# 单场（用现有 mossASR 转写联调，无需实时 ASR）
python -m pipeline.cli run <videoId> --from-moss-result <mossASR/results/xxx.json> [--dry-run]

# 单场（Moss 服务就绪后，自动定位本地媒体 + 实时 ASR + 长视频切块）
python -m pipeline.cli run <videoId>

# 全量（发现三个下载目录里的所有本地视频）
python -m pipeline.cli run --all

# 状态 / 重置
python -m pipeline.cli status [videoId]
python -m pipeline.cli reset <videoId> [--stage STAGE]
```

- `--dry-run` 或未设 `ANTHROPIC_API_KEY`：LLM 走**确定性桩**，管道端到端可跑（质量待真实 key）。
- `--force`：忽略已成功状态与 qc error，强制重跑/放行。

## 当前就绪状态

| 能力 | 状态 | 依赖 |
|---|---|---|
| probe / segment / aggregate / qc / emit | ✅ 可跑 | 系统 ffprobe/ffmpeg |
| transcribe（adapter 桥接现有 Moss 产出） | ✅ 可跑 | `--from-moss-result` |
| transcribe（实时 ASR + 长视频切块拼接） | 🔌 代码就绪 | **Moss CLI**（另一 session 按 `contracts/moss-asr-contract.md` 部署） |
| extract / aggregate（真实 LLM 质量） | 🔌 代码就绪 | **`ANTHROPIC_API_KEY`** |
| visual（关键帧抽取 + Gemini 解析） | 🔌 触发+计划就绪 | `GEMINI_API_KEY` + 抽帧实现（`visual.run_visual` 内 TODO） |

已验证：现有 `fWa7uxyhVDE` keynote 转写 → 8 阶段全跑通 → 产出 enrichment → 合并进 dataset。

## 契约

- `contracts/moss-asr-contract.md` + `moss_asr_result.schema.json`：ASR provider 输入输出。
- `contracts/enrichment-contract.md`：enrichment/editorial → dataset 的合并与投影。

## 目录

```
pipeline/
├── cli.py            编排器（阶段状态 + 断点续跑 + 命令）
├── config.py         路径/版本/阈值（冻结点）
├── state.py          SQLite 阶段状态
├── media.py          ffprobe manifest + 长视频切块（原生 ffmpeg）
├── transcribe.py     ASR 编排（adapter / Moss 切块拼接）
├── segment.py        章节切分（证据锚点 + 视觉触发标记）
├── llm.py            章节提炼 + 全片 Reduce（urllib 调 API + 桩）
├── visual.py         按需视觉触发 + 计划
├── qc.py             自动质检（证据链/时间戳/去重/覆盖率）
├── emit.py           投影 → data/enrichments/<id>.json
├── asr/              统一 schema + provider（moss / adapter）
└── contracts/        跨端契约（见上）
```
