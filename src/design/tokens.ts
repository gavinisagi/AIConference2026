/**
 * 设计 tokens（TS 侧镜像）。
 *
 * 唯一事实来源：design-spec.md §3.2 / §3.3 / §3.4。
 * CSS 侧的权威声明在 `src/design/theme.css`（全局 :root 变量）；本文件为 TS 侧镜像，
 * 供组件逻辑取用（例如大会枚举 -> 色标、状态枚举 -> 文案/CSS 类）。
 * 二者数值必须保持一致（见 docs/design-system.md 的「数值同步」约定）。
 *
 * 组件样式一律通过 CSS 变量 `var(--token)` 引用，不在此处内联颜色到 JSX，
 * 以保证「一次定死」的样式方案与深色模式预留命名可无侵入扩展。
 */

/** 视频状态枚举（design-spec §2.3）。 */
export type VideoStatus = 'recommended' | 'indexed' | 'analyzing';

/** 大会枚举（design-spec §2.3）。 */
export type Conference = 'ai-engineer' | 'cursor-compile' | 'figma-config';

/** 主题枚举（design-spec §2.3）。 */
export type Topic =
  | 'agent'
  | 'ai-coding'
  | 'evals'
  | 'context'
  | 'design-to-code'
  | 'ai-product';

/** 颜色 token（镜像 theme.css，暖纸档案调）。 */
export const color = {
  paper: '#F4F2EC',
  surface: '#F4F2EC',
  surfaceSunken: '#EFEDE5',
  ink: '#1A1814',
  inkSecondary: '#3A3730',
  inkMuted: '#6F6A5E',
  inkFaint: '#8C8676',
  hairline: '#DCD8CD',
  hairlineStrong: '#CFCABD',
  accent: '#A9481E',
  accentHover: '#1A1814',
  accentTint: '#F0E7E0',
} as const;

/** 三态视觉元数据：文案 + 色值（§3.2）。全站 recommended 为视觉锚点。 */
export const statusMeta: Record<
  VideoStatus,
  { label: string; ink: string; bg: string }
> = {
  recommended: { label: '推荐先看', ink: '#8A4A12', bg: '#F2E6D8' },
  indexed: { label: '已收录', ink: '#3A3730', bg: '#E4E1D7' },
  analyzing: { label: '解读中', ink: '#2C6355', bg: '#E0E8E2' },
};

/** 大会元数据：显示名 + 色标（仅识别用途，不铺色）。 */
export const conferenceMeta: Record<Conference, { label: string; dot: string }> = {
  'ai-engineer': { label: "AI Engineer World's Fair", dot: '#2C6355' },
  'cursor-compile': { label: 'Cursor Compile', dot: '#1A1814' },
  'figma-config': { label: 'Figma Config', dot: '#5B3E8C' },
};

/** 主题显示名（§2.3 / §4.1 区块 6）。英文专有名词保留原文。 */
export const topicMeta: Record<Topic, { label: string }> = {
  agent: { label: 'Agent' },
  'ai-coding': { label: 'AI 编程' },
  evals: { label: 'Evals' },
  context: { label: 'Context' },
  'design-to-code': { label: 'Design-to-Code' },
  'ai-product': { label: 'AI 产品' },
};

/** 间距刻度（4px 基，§3.4）。 */
export const space = {
  4: '4px',
  8: '8px',
  12: '12px',
  16: '16px',
  24: '24px',
  32: '32px',
  48: '48px',
  64: '64px',
  96: '96px',
} as const;

export const tokens = {
  color,
  statusMeta,
  conferenceMeta,
  topicMeta,
  space,
} as const;

export type Tokens = typeof tokens;
