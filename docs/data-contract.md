# 数据契约 — AI Conference 2026 Compass（T1 · AIO-28）

> 版本 datasetVersion=1 · 负责人 Linus（工程）· 对齐 design-spec §2.3
> 状态：董事会共享对齐基准。**本契约是「视频清洗产出」与「网站消费」之间的唯一对齐基准**——上游清洗按本契约产出字段，下游页面按本契约消费。

---

## 0. 是什么 / 从哪来 / 到哪去

- **上游**：真实语料 `data/catalog.json`（941 场 / 409 小时 / 三大会）。
- **规范化器**：`scripts/build-data.mjs`（纯构建期，无后端、无数据库、无运行时抓取）。
  读取语料 → 规范化为下述模型 → 派生统计与主题近似计数 → 写出 `src/data/dataset.json`。
- **类型契约**：`src/lib/schema.ts`（TypeScript 类型，站点侧单一事实来源）。
- **加载层**：`src/lib/loader.ts`（只读访问器 + 降级辅助，站点唯一消费入口）。
- **校验**：`scripts/check` 触发 `node scripts/build-data.mjs --verify`——全量逐条 schema
  校验 + 与已提交 `dataset.json` 的漂移比对，任一不通过即非零退出。

三处（生成器 / TS 类型 / 本文档）必须保持一致；本文档为人读权威。

---

## 1. 枚举取值

| 枚举 | 取值 | 说明 |
|---|---|---|
| `ConferenceId` | `ai-engineer` · `cursor-compile` · `figma-config` | 三大会（design-spec §2.3） |
| `SessionStatus` | `recommended`(推荐先看) · `indexed`(已收录) · `analyzing`(解读中) | design-spec §3.2 |
| `Role` | `developer` · `product-design` · `founder-lead` · `trend` | design-spec §2.3 |
| `Topic` | `agent` · `ai-coding` · `evals` · `context` · `design-to-code` · `ai-product` | design-spec §2.3 |

大会色标（design-spec §3.2，仅识别不铺色）：
`ai-engineer #2F5D50` · `cursor-compile #3A3A3A` · `figma-config #6B4E9E`。

---

## 2. `Session`（Video/Session，核心记录）

| 字段 | 类型 | 必填 | 来源 / 派生 | 缺省时降级 |
|---|---|---|---|---|
| `id` | `string` | ✅ 不可编造 | `video_id` | 缺失则整条记录不入库 |
| `title` | `string` | ✅（可空串） | `title`（trim） | 源为空 → 空字符串；UI 用 `displayTitle()` 兜底「（未命名 session）」 |
| `conferenceId` | `ConferenceId` | ✅ 不可编造 | `source` 映射 | 无法映射则整条记录不入库 |
| `officialUrl` | `string` | ✅ 不可编造 | `url` | 缺失则整条记录不入库 |
| `sourceUrl` | `string` | — | `source_url` | 缺失 → 空字符串 |
| `playlistIndex` | `number \| null` | — | `playlist_index` | 缺失 → `null` |
| `durationSeconds` | `number \| null` | — | `duration`（>0） | `0`/缺失 → `null` |
| `durationMinutes` | `number \| null` | — | `round(duration/60)` | 无时长 → `null` |
| `publishedDate` | `string \| null` | — | `upload_date` | 空 → `null`（当前语料**全为 null**） |
| `thumbnailUrl` | `string \| null` | — | `thumbnail` | 空 → `null`（当前语料**全为 null**） |
| `topics` | `Topic[]` | — | 标题关键词近似分类 | 无命中 → `[]` |
| `status` | `SessionStatus` | ✅ | 默认 `indexed` | 恒为 `indexed`（见 §4） |
| `speakers` | `Speaker[]` | — | —（语料无可靠讲者字段） | **恒为 `[]`**，待真实标注（见 §4） |
| `whyWatch` | `string \| null` | — | —（编辑产出） | **恒为 `null`**（见 §4） |
| `takeaways` | `Takeaway[]` | — | —（编辑产出） | **恒为 `[]`**（见 §4） |
| `roles` | `Role[]` | — | —（编辑标注） | **恒为 `[]`**（见 §4） |

`Speaker`：`{ name: string; org: string | null }`。

---

## 3. `Takeaway`（观点卡，design-spec §6.1）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 唯一 id |
| `sessionId` | `string` | 所属 Session id（校验时须等于父 session.id） |
| `statement` | `string` | 一句话观点（卡片主角） |
| `context` | `string \| null` | 支撑上下文 |
| `timestampSeconds` | `number \| null` | 官方源深链时刻（秒） |
| `roles` | `Role[]` | 适用角色 |

当前真实数据 **0 条**——类型已就绪，数据为空，UI 走 empty 态（「本周精选整理中」）。

---

## 4. 缺省与降级（本契约核心规则）

design-spec 与任务约束明确：`whyWatch` / `takeaways` / 角色标注 / 讲者当前为空（0 条），
模型与加载层**必须允许缺省并优雅降级，不得编造**。

- **不可编造的必填**：`id` / `conferenceId` / `officialUrl`。任一缺失或不可映射，
  该记录被规范化器丢弃（记入 `_droppedRecords`），`--verify` 会因 dropped>0 而失败。
  当前语料 941 条全部满足，dropped=0。
- **可降级为 `null` / `[]`**：其余字段缺失一律降级，不抛错、不伪造：
  - `whyWatch = null` → 详情页显示「深度解读整理中，先看官方原片」+ 官方链接（§7.1）。
  - `takeaways = []` → 观点卡区走 empty 态。
  - `roles = []` → 首页/目录**不显示编造的「N 内容」角标**（design-spec §4.1）。
  - `speakers = []` → 讲者行留空，不伪造姓名（design-spec §10 内容真实性）。
  - `topics = []` → 该场不计入任何主题近似计数。
  - `durationSeconds = null` → `displayDuration()` 返回 `—`（§7.1 统计条降级）。
- **深度解读计数**：`stats.deepReadCount` 现为 `0`；`displayDeepReadStatus()` 在为 0 时
  返回「进行中」而非编造条数（design-spec §4.1/§5.1）。
- **原则**：官方来源链接与基础元信息永远优先渲染，编辑增值内容可降级；
  任何字段缺失不得导致整页白屏。加载层 `isValidSession()` 会过滤坏记录后再消费。

**演进**：`status`（recommended/analyzing）、`roles`、`whyWatch`、`takeaways`、`speakers`
均由后续编辑/清洗流程回填。回填即覆盖本派生结果，契约字段与形状不变。

---

## 5. 统计口径（`SiteStats`，全部派生自真实语料，不写死占位数）

| 字段 | 当前值 | 派生方式 |
|---|---|---|
| `totalSessions` | `941` | 有效 session 数 |
| `totalDurationSeconds` | `1471027` | Σ `duration` |
| `totalHours` | `409` | `round(totalDurationSeconds / 3600)` |
| `withDuration` | `932` | 有有效时长的场次数（9 场时长缺失） |
| `deepReadCount` | `0` | `whyWatch` 非空条数 → UI 显示「进行中」 |
| `byConference` | `ai-engineer 853 · figma-config 78 · cursor-compile 10` | 分大会计数（来源极不均，稀疏源须接空状态） |

### 主题近似计数（`topicCounts`，`method: title-keyword`）

标题子串关键词命中的**近似归类**，非精确编目——展示须以「约」标注（design-spec §6）。
一场可命中多个主题。关键词集合定义于 `scripts/build-data.mjs` 的 `TOPIC_KEYWORDS`。

当前派生值：`agent ≈264 · ai-coding ≈108 · evals ≈81 · context ≈79 · design-to-code ≈61 · ai-product ≈82`
（与 design-spec §6 给出的示例近似值同量级；正式主题标签由后续编辑流程建立后覆盖）。

---

## 6. `dataset.json` 顶层形状（`NormalizedDataset`）

```jsonc
{
  "datasetVersion": 1,
  "generatedFrom": "data/catalog.json",
  "sourceRecordCount": 941,
  "contract": { "statuses": [...], "roles": [...], "topics": [...] },
  "stats": { /* SiteStats，见 §5 */ },
  "conferences": [ /* Conference[]，含色标与 sessionCount */ ],
  "sessions": [ /* Session[]，见 §2 */ ],
  "_droppedRecords": [] // 不可降级的坏记录，正常为空
}
```

---

## 7. 消费方式（加载层 API）

`src/lib/loader.ts` 提供只读访问器（页面不得直接读 JSON，统一走加载层）：

- `getAllSessions()` / `getSessionById(id)`
- `getConferences()` / `getConferenceById(id)`
- `getSiteStats()` / `getTopicCounts()`
- `getSessionsByConference(id)` / `getSessionsByTopic(topic)` / `getSessionsByRole(role)`
- 降级辅助：`displayTitle(s)` / `displayDuration(s)` / `hasWhyWatch(s)` / `displayDeepReadStatus()`

---

## 8. 再生与校验

```sh
node scripts/build-data.mjs          # 重新生成 src/data/dataset.json（改语料或关键词后运行）
node scripts/build-data.mjs --verify # 全量 schema 校验 + 漂移比对（check 内置调用）
npm run check                        # 跨平台校验入口：data verify → lint → typecheck → 静态导出
```
