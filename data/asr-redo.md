# 需重跑 ASR 的场次

体检 `mossASR/results/` 转录产物时判定为不可用、已从清洗批次中排除的场次。
重跑 Moss 转写并通过体检后，即可用 `--from-moss-result` 正常入库：

```bash
python -m pipeline.cli run <videoId> --from-moss-result <路径>/<videoId>.json
```

体检口径见本文件末尾，可复现。

## Figma Config 2026（10 / 71 场）

### A. 空转录（segments 为 0）

Moss 返回 0 段，QC 的 `asr-empty` 会拦截。共 6 场：

| videoId | 时长 | 标题 |
|---|---|---|
| `CaF0t8QrQjE` | 19min | 10 years of daily sketching ft. Zach Lieberman (MIT Media Lab) |
| `GpACvdM6guc` | 26min | Reimagining NASA.gov for Earth's most important stories |
| `cWggqwauYXQ` | 19min | In praise of dark mode ft. Mehmet Aydın Baytaş (Attio) |
| `lY3dhHTJGWQ` | 21min | Design systems anarchy ft. Lauren LoPrete (Mercury) |
| `njz16gKVLFs` | 19min | Usernames on Instagram: how a craft fix became an identity crisis |
| `thvAivrQ4TI` | 20min | The rules are the art: creating with AI ft. Holly Herndon |

### B. 语言幻觉（英文演讲被转成俄语）

与此前一次「英文演讲被转成意大利语」是同一故障模式，转写内容与原片无关，
全片不可用。共 4 场：

| videoId | 时长 | 标题 | 备注 |
|---|---|---|---|
| `2zmW-L1jtjc` | 21min | Legibility by design ft. Ryan Powell (Waymo) | 首段 `Привет всем, меня зовут Райан Пал…` |
| `Q-0BqAhVrfQ` | 20min | Designing brand intelligence ft. Nicole Martinez | |
| `WGZ38oeoBtU` | 24min | The canvas is not dead ft. Catt Small (Dropbox) | |
| `XOVcpvbblGY` | 17min | Designing with confidence in an AI-powered world | 另只覆盖 168s / 1042s |

## 体检口径

对每份转录：

- **空转录** — `segments` 为空。
- **语言幻觉** — 非拉丁字符（西里尔/泰/谚文/假名）加中日韩字符占全文 > 2%。
  本站语料均为英文演讲，正常转写不会触发。
- **覆盖不足** — 末段 `end` < 视频时长 × 60%（提示中途中断）。

## 现状

Figma Config 本地 71 场素材、转录 71 份，其中 61 份可用并已进入清洗流水线；
上述 10 场待重转。catalog 中另有 7 条时长为 0、标题为空的记录（失效/私有视频），
不计入素材。
