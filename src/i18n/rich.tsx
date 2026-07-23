import type { ReactNode } from 'react';

/**
 * 富文本片段：纯字符串按原样渲染，{ b } 用 <b> 包裹（加粗强调）。
 * 用于「一句话里有几处加粗强调」的文案（如 site.footerDisclaimer、hub.lead）——
 * 字典条目返回片段数组而非单一字符串，避免 {placeholder} 字符串替换无法
 * 承载 JSX 元素的问题，同时保留每种语言按自己的语序组句的自由度。
 */
export type RichPart = string | { b: string };

/** boldClassName：需要给加粗片段单独上色时传入（如「真正值得盯屏约 **N 分钟**」的 N 分钟要走强调色，前缀不要）。 */
export function renderRich(parts: readonly RichPart[], boldClassName?: string): ReactNode {
  return parts.map((part, i) =>
    typeof part === 'string' ? part : (
      <b key={i} className={boldClassName}>
        {part.b}
      </b>
    ),
  );
}
