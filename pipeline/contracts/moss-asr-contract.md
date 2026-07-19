# Moss ASR 服务契约（producer ⇄ pipeline）

> 状态：**权威契约**。producer 侧（`mossASR/`，由另一 session 实现并本地部署）与 consumer 侧
> （本仓库 `pipeline/`，ASR provider）之间的唯一对齐基准。
> 机器可校验的输出形状见同目录 [`moss_asr_result.schema.json`](./moss_asr_result.schema.json)——**producer 每次输出都必须能通过该 schema 校验**。

本文件是给 **mossASR 实现方**的施工图。读完你应该清楚：给你一个文件，你要吐出什么，边界到哪为止。

---

## 1. 角色与边界（谁负责什么）

| 关注点 | 负责方 | 说明 |
|---|---|---|
| WSL2 + vLLM 服务生命周期、显存、CUDA graph 冷启 | **producer（你）** | 完全隐藏在服务内，pipeline 不感知 WSL |
| 视频 → 16kHz 单声道 FLAC 音频提取 | **producer（你）** | 你已在 `asr_client.py:extract_audio` 做了 |
| 单次调用的转写 + 说话人分离 | **producer（你）** | 输出满足 schema 的统一 JSON |
| **长视频切块（>28min）** | **pipeline（我）** | 我用 ffmpeg 在静音/章节边界切成 ≤25min 带重叠的块，逐块调你 |
| 跨块 speaker 拼接、去重、`speakerScope=chunk` 改写 | **pipeline（我）** | 你只保证**单次调用内** speaker 全局一致 |
| LLM 提炼、视觉补充、质检、落 `enrichments/` | **pipeline（我）** | 与你无关 |

**一句话边界**：你收到**一个 ≤28min 的音频/视频文件**，返回**一份满足 schema 的 JSON**，服务起停你自理。就这些。长视频不用你操心切分——我切好再喂给你。

---

## 2. 主接口：CLI（首选）

producer 需提供一个可被 Windows 侧 Python 直接 `subprocess` 调用的命令，输入一个文件、写出一份统一 JSON：

```
<producer-python> mossASR/scripts/moss_transcribe.py <INPUT> --out <OUT.json> \
    [--video-id <ID>] [--prompt "<热词提示>"]
```

- `<INPUT>`：音频或视频文件绝对路径（≤28min 单次可靠）。
- `--out <OUT.json>`：产出 JSON 的目标路径（父目录若不存在需自建）。
- `--video-id <ID>`：可选。不传时，从文件名末尾 `[VIDEOID]` 解析（yt-dlp 约定，等于 `data/catalog.json` 的 `video_id`）。解析不到且未传 → **非零退出并报错**，不要编造。
- `--prompt`：可选热词提示（提高专有名词/中英混合识别，沿用你现有 prompt 机制）。

**成功**：退出码 `0`，`--out` 路径写出通过 `moss_asr_result.schema.json` 的 JSON。
**失败**：退出码非 `0`，stderr 打印可诊断信息，**不写出半成品 JSON**（或写出后确保 pipeline 能靠退出码判失败）。

> 你现有的 `asr_client.py` 已完成 90%：它已产出 `{start,end,speaker,text}` 分段 + 耗时/rtf。
> 改造点只有：**① 按本 schema 补齐字段（见 §3），② 输出单文件到 `--out`，③ 退出码语义**。

### 备选接口：HTTP（若你更愿意保留服务端接口）

沿用现有 `POST http://127.0.0.1:8000/v1/audio/transcriptions`（返回 `{text: "<raw>"}`）。
若走这条，请**额外提供**一个把 `raw text` 解析为本 schema 的稳定入口（等价于把 `parse_transcript` 的产物按 schema 序列化），否则 pipeline 要重复实现你的解析逻辑，易漂移。**首选 CLI**。

---

## 3. 输出字段：producer 必须填 vs 可留空

以 27min keynote 为例，你的 `--out` JSON 形如：

```jsonc
{
  "schemaVersion": 1,
  "source": {
    "videoId": "fWa7uxyhVDE",        // 必填。文件名 [xxx] 解析或 --video-id
    "inputPath": "C:\\...\\01 - Opening Keynote ... [fWa7uxyhVDE].mp4",  // 必填
    "mediaSha256": null,             // 可 null（pipeline 补）
    "durationSeconds": 1620.53       // 必填，真实时长
  },
  "asr": {
    "provider": "moss-asr",          // 必填，固定
    "model": "OpenMOSS-Team/MOSS-Transcribe-Diarize",  // 必填
    "backend": "vLLM (WSL2)",        // 可 null
    "language": "en",                // 必填。检测到的主语言 ISO 639-1
    "speakerScope": "global",        // 必填，producer 一律 "global"
    "createdAt": null,               // 可 null
    "inferenceSeconds": 245.1,       // 可 null（建议填，用于监控）
    "rtf": 0.151                     // 可 null
  },
  "segments": [
    {
      "id": "seg_00001",             // 必填。零填充、按序、单次调用内唯一
      "start": 0.75,                 // 必填（秒，相对输入起点）
      "end": 4.26,                   // 必填，>= start
      "speaker": "S01",              // 必填。S01/S02..，单次调用内一致
      "text": "...",                 // 必填（UTF-8）
      "avgLogprob": null             // Moss 无则 null
    }
  ]
}
```

**硬要求**：
- `segments[].id` 形如 `seg_00001`（`^seg_\d{5,}$`），按 `start` 升序，单次调用内唯一。这是证据链回指的锚点，必须稳定。
- `speaker` 形如 `S01`（`^S\d{2,}$`），**单次调用内全局一致**；不要输出真实姓名。
- `language` 必填（你至少能从模型/输入推断；拿不准填最可能值，别留空）。
- 全程 UTF-8，CJK 不得乱码（你 client 已 `reconfigure(encoding="utf-8")`，保持）。

**可留 null**：`mediaSha256` / `createdAt` / `inferenceSeconds` / `rtf` / `backend` / `avgLogprob`。

---

## 4. 长视频：pipeline 怎么用你（你不用改）

- `≤28min`：pipeline 直接把整片喂给你，`speakerScope=global` 原样采纳。
- `28–60min` / `>60min`：pipeline 先用 ffmpeg 在静音/章节边界切成 ≤25min、带 10–15s 重叠的块，**逐块**调你的 CLI。每块你都当独立整段处理、输出 `global`。拼接、重叠去重、跨块 speaker 归并、把整片 `speakerScope` 标成 `chunk` 都是 pipeline 的事。

所以你**永远只需要处理 ≤28min 的单文件**。当前 91 场里超 28min 的约 8 场，最长 ~72min，都由 pipeline 切好再给你。

---

## 5. 运维 / 健康检查（producer 需保证）

pipeline provider 调用前会做健康探测，你需保证：
- 有一个**幂等的健康检查**（现有 `GET /health` 即可）；服务未起时 CLI 能**自动拉起**（你的 `start_server.ps1` 已幂等）或明确报错让 pipeline 停下。
- 首次冷启（CUDA graph 编译）~2–3min 属正常；pipeline 会给足超时。
- 空闲显存占用 ~7GB；批处理期间 pipeline 会**串行**调用（不并发压你），跑完可 `stop.cmd` 释放。
- 单次 >28min 可能因上下文不足失败——**但 pipeline 不会给你超 28min 的输入**，所以正常不会触发。

---

## 6. 验收（producer 完成的标准）

对 `mossASR/results/` 里已有的两场（keynote_audio、Compile 26 Opening Keynote）重跑一遍，产出的 `--out` JSON：

1. 用 `moss_asr_result.schema.json` 校验通过（draft-07）。
2. `source.videoId` 正确（Compile keynote 应为 `fWa7uxyhVDE`）。
3. `segments` 有序、id 连续、speaker 一致、文本 UTF-8 无乱码。
4. CLI 成功退出码 0、失败非 0。

pipeline 侧我会写一个 `pipeline/providers/moss.py` 按本契约调你 + 校验你输出。你只要过上面 4 条，我这边即插即用。

---

## 7. 交接物清单（给 producer session）

- 本文件 + `moss_asr_result.schema.json`（权威，位于本仓库，绝对路径见下）。
- 你要交付：`mossASR/scripts/moss_transcribe.py`（或等价 CLI）+ 一次对两场样本的验收产出。
- 完成后本地保持服务可 `start_server.ps1` 拉起、`/health` 返回 200 即可，我这边直接调。

> 权威契约绝对路径（供另一 session 引用）：
> `C:\Users\tiany\Desktop\Projects\AIConference2026\pipeline\contracts\moss-asr-contract.md`
> `C:\Users\tiany\Desktop\Projects\AIConference2026\pipeline\contracts\moss_asr_result.schema.json`
