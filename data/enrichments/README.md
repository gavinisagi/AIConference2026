# data/enrichments/

视频清洗流水线的**可发布 AI 产物**，每场一个 `<videoId>.json`。

由 `pipeline/` 产出，被 `scripts/build-data.mjs` 按 `editorial > enrichment > catalog派生 > 缺省`
合并进 `src/data/dataset.json`。形状与投影规则见
[`pipeline/contracts/enrichment-contract.md`](../../pipeline/contracts/enrichment-contract.md)。

- 目录为空时合并是空操作，站点走缺省降级。
- 坏 JSON / 非法字段 → 跳过并告警，不阻塞构建。
- 本目录 JSON **入库**（它们是站点内容的真实来源）；原始转写/中间产物不入库（见 `.gitignore`）。
