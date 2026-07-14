/**
 * 设计 tokens 占位（T1 填充）。
 *
 * 后续在此集中定义颜色、排版、间距、圆角等设计变量，供 components 与 app 复用。
 * 现在仅放一个占位导出，确保 src/design/ 目录成立且可被 typecheck 收录。
 */

export const tokens = {} as const;

export type Tokens = typeof tokens;
