# data/editorial/

**人工覆盖 / 推荐决策**，每场一个 `<videoId>.json`，只写要覆盖的字段。

合并优先级最高（压过 enrichment 与 catalog 派生）。典型用途：把某场 `status` 设为
`recommended`（首页推荐是编辑决策，不等于模型跑完）、改写 `whyWatch`、订正 takeaways。

形状见 [`pipeline/contracts/enrichment-contract.md`](../../pipeline/contracts/enrichment-contract.md) §3。
本目录 JSON 入库。
