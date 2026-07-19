# 设计系统落地约定（Design System）

> 任务 AIO-29 · T2 · 负责人 Linus · 唯一设计事实来源：`design-spec.md` §3。
> 本文件记录**样式方案决策**与**token 同步约定**，供 T3–T6 一致遵循。

## 1. 样式方案（一次定死）

**决策：CSS Modules（`*.module.css`）+ 全局 CSS 变量主题。不引入 Tailwind 或任何运行时 UI 框架。**

理由：

- 纯静态导出（`next.config.mjs` `output: 'export'`），无运行时框架符合任务约束。
- CSS Modules 是 Next.js 15 内建能力，零额外依赖、类名局部作用域、构建期即产出静态 CSS。
- 设计系统以「token 驱动」为核心：颜色/字阶/间距/圆角/阴影全部由 CSS 变量声明，组件样式一律 `var(--token)` 引用，不内联 hex。

**T3–T6 一致规则：**

1. 页面/组件私有样式 → 同目录 `*.module.css`，类名走 `styles.x`。
2. 跨页复用的字阶/排版 → 用 `globals.css` 的工具类（`.t-display` / `.t-h2` / `.t-h3` / `.t-body-l|m|s` / `.t-label` / `.t-meta` / `.reading`）。
3. 颜色/间距/圆角/阴影/字族 → **只能**引用 `theme.css` 的 CSS 变量，禁止新增未定义色值（design-spec §3.2 为唯一色源）。
4. 组件从 `@/components` barrel 取用，不深引各组件目录。

## 2. 目录结构（repo-layout）

```
src/
├── app/
│   ├── globals.css          # 全局 reset + 字阶工具类 + 中英文混排（§7.2）
│   ├── layout.tsx           # 引入 globals.css，lang="zh-CN"
│   └── styleguide/          # 组件画廊（可视化校验），导出 out/styleguide/index.html
│       ├── page.tsx
│       └── styleguide.module.css
├── design/
│   ├── theme.css            # CSS 侧 token 权威声明（:root 变量，§3.2/§3.3/§3.4）
│   └── tokens.ts            # TS 侧镜像（枚举 -> 文案/色标映射，供组件逻辑取用）
└── components/              # 基础组件，每个组件一个目录（Component.tsx + Component.module.css）
    ├── index.ts             # barrel 导出
    ├── Button/  Card/  Chip/  StatusBadge/  ConfBadge/
    └── DurationTag/  MetaRow/  TakeawayCard/
```

## 3. Token 同步约定（theme.css ⇄ tokens.ts）

- `theme.css` 是 **CSS 侧**权威（组件样式引用 `var(--token)`）。
- `tokens.ts` 是 **TS 侧镜像**，仅承载组件**逻辑**需要的数据：状态/大会/主题枚举 → 文案与色标映射。
- 二者数值必须一致。**修改颜色时两处同步更新**，并抽查 styleguide 导出的 CSS 是否命中（如 `--accent=#1B3A5B`、`--paper=#FBFAF8`）。
- design-spec §3.2 是二者共同的上游事实来源；三者不一致时以 design-spec 为准。

## 4. 基础组件清单（design-spec §3 / §6.1）

| 组件 | 规范来源 | 说明 |
|---|---|---|
| `Button` | §3.7 | primary / secondary / text 三变体，44px 触控高 |
| `Card` | §3.5 | 8px 圆角 + 发丝线；`interactive` hover 上浮；`recommended` 左强调条 |
| `Chip` | §3.6 | 主题标签，可选 `href` 变可点击 |
| `StatusBadge` | §3.2 | 三态：recommended(★) / indexed(圆点) / analyzing(脉冲点)，**必须可区分** |
| `ConfBadge` | §3.6 | 大会色标，6px 圆点 + 名称，仅识别 |
| `DurationTag` | §3.6 | 等宽体时长 `18 min` / `1 h 02` + 时钟微图标 |
| `MetaRow` | §6.1 | 元信息行，中点分隔，承载讲者/时长/主题 |
| `TakeawayCard` | §6.1 | 观点卡，复合上述组件；首页精选与详情页复用 |

## 5. 关键约束落地

- **三态可区分**：颜色 tint + 图标形态双通道区分；`recommended` 额外由 Card 左强调条锚定。
- **4px 刻度**：间距/圆角变量均为 4px 倍数；圆角 chip=4 / btn=6 / card=8（不超 8）。
- **深色模式**：v1 非目标，`theme.css` 文末仅预留命名注释，不实装（§9）。
- **中英文混排**（§7.2）：`globals.css` 设 `text-spacing-trim`（渐进增强）；数字/时长用等宽体 `tabular-nums` 防跳动；专有名词保留英文原文。
- **动效**：150–200ms ease-out，`prefers-reduced-motion` 全局降级。

## 6. 校验入口

- `sh scripts/check`（lint + typecheck + build）退出 0。
- 组件画廊静态导出：`out/styleguide/index.html`。
