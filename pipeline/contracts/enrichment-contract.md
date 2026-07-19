# 回填层契约：enrichments / editorial（pipeline ⇄ build-data）

> 状态：**权威契约**。定义视频清洗流水线产出（`data/enrichments/`）与人工编辑覆盖
> （`data/editorial/`）如何被 `scripts/build-data.mjs` 合并进站点消费的 `dataset.json`。
> 落地的是 `docs/data-contract.md` §4 早已承诺的「回填层」——**契约字段与形状不变**。

## 1. 三层与合并优先级

```
data/catalog.json          来源事实（941 场）→ normalizeRecord 派生缺省
data/enrichments/{id}.json 可发布 AI 清洗产物（pipeline 产出）
data/editorial/{id}.json   人工覆盖 / 推荐决策（最高优先）
        │  build-data.mjs 逐字段合并：editorial > enrichment > catalog派生 > 缺省
        ▼
src/data/dataset.json      站点唯一消费快照（形状见 docs/data-contract.md §6）
```

- 文件名 = `<videoId>.json`（等于 catalog 的 `video_id`，也等于 ASR 契约的 `source.videoId`）。
- 两个目录**不存在或为空 → 合并是空操作**，输出与纯 catalog 派生字节一致（`--verify` 照过）。
- 合并**逐字段**：某字段没给就保留下层值；给了非法值 → **忽略该字段并 stderr 告警**，绝不破坏 schema、不阻塞整站。
- 坏 JSON 文件 → 跳过 + 告警，不拖垮构建。

## 2. enrichment 文件（pipeline 产出，可发布）

`build-data` 只投影下列**契约字段**进 `dataset.json`；其余富信息（summary/chapters/language/evidence…）
允许存在但站点当前不消费（未来扩展 schema 时再投影）。

```jsonc
{
  "schemaVersion": 1,
  "videoId": "fWa7uxyhVDE",                 // 必须等于文件名与 catalog video_id
  "generatedBy": {                          // 溯源（可选，站点不消费）
    "pipelineVersion": "0.1.0",
    "asrProvider": "moss-asr",
    "llmModel": "claude-opus-4-8",
    "promptVersion": "chapter-extract@1"
  },

  // ---- 投影到 dataset.json Session 的字段 ----
  "topics":  ["agent", "ai-coding"],        // 覆盖标题近似分类；省略=保留近似值
  "roles":   ["developer", "founder-lead"], // 契约角色枚举
  "speakers":[{ "name": "Michael Truell", "org": "Cursor" }],
  "whyWatch":"一句话「为什么值得看」，或 null",
  "takeaways":[
    {
      "statement": "一句话观点（卡片主角）",  // 必填
      "context": "支撑上下文，或省略",
      "timestampSeconds": 183,               // 官方源深链时刻；程序由 evidenceSegmentIds 算，不许 LLM 猜
      "roles": ["developer"],
      // 下面几项站点不消费，但建议保留做审核/追溯：
      "evidenceSegmentIds": ["seg_00012"],   // 回指 ASR 分段（证据链）
      "confidence": 0.9,
      "visualDependency": false
    }
  ],

  // ---- 观看导览（承接层核心资产，站点 /video 与 /compile 消费）----
  "tour": {
    "hook": "一句话钩子",
    "whoShouldWatch": "谁最该看",
    "ifShortOnTime": "时间不够看哪段",
    "mustWatch": [{ "startSeconds": 1030, "endSeconds": 1110, "label": "...", "live": true, "why": "..." }],
    "stops": [{ "startSeconds": 0, "endSeconds": 340, "title": "...", "what": "...", "keyPoint": "...",
                "howTo": "watch|skim|listen", "howToReason": "...", "speaker": "..." }]
  },

  // ---- 内部富信息（站点暂不消费，保留待扩展）----
  "summary": "全片摘要",
  "chapters": [ { "title": "...", "startSeconds": 0, "summary": "..." } ],
  "language": "en"
}
```

**tour 投影**：`build-data` 的 `sanitizeTour` 严格校验——无 `hook` 或 `stops` 为空即整个 tour 忽略（降级 null）；
`howTo` 非 watch/skim/listen 回落 watch。站点 `Session.tour` 有值时 `/video/<id>` 走观看导览，否则走详情降级。

**投影规则**（build-data 如何取用）：
- `topics/roles`：须为契约枚举数组，否则整字段忽略。
- `speakers`：`{name(非空), org|null}`；任一非法 → 整字段忽略。
- `takeaways`：逐条投影为契约 `Takeaway{id,sessionId,statement,context,timestampSeconds,roles}`；
  `id` 省略时自动生成 `<videoId>-tk<N>`，`sessionId` 强制置为 videoId，`evidence/confidence/visualDependency` 被丢弃（站点不消费）。任一条 `statement` 缺失 → 整个 takeaways 覆盖忽略。
- `whyWatch`：非空字符串或显式 `null`。

## 3. editorial 文件（人工覆盖，最高优先）

形状 = enrichment 可投影字段的**子集**，只写要覆盖的字段：

```jsonc
{
  "videoId": "fWa7uxyhVDE",
  "status": "recommended",          // recommended | indexed | analyzing（编辑决策，非模型跑完）
  "whyWatch": "编辑改写的推荐语",     // 覆盖 enrichment
  "takeaways": [ /* 同 §2，整组覆盖 */ ],
  "topics": ["agent"], "roles": ["developer"], "speakers": [ /* ... */ ]
}
```

- `status` 只在 editorial 层设置（`recommended` 是编辑决策，不等于「模型跑完」）。
- editorial 任一字段都压过 enrichment 与 catalog 派生。

## 4. 校验与再生

```sh
node scripts/build-data.mjs           # 读三层 → 合并 → 写 dataset.json
node scripts/build-data.mjs --verify  # 全量 schema 校验 + 漂移比对（npm run check 内置）
```

pipeline 写出 enrichment 后跑一次 `node scripts/build-data.mjs && npm run check` 即完成「AI 产物上站」。
