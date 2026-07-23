/**
 * 站点语言：中文（默认，不带前缀，URL 与既有部署保持不变）/ 英文（/en 前缀镜像路由）。
 *
 * 未采用 Next.js 的 [locale] 动态段方案——那需要把中文路由也挪到 /zh 前缀下，
 * 会破坏已经上线并分享出去的 URL（/、/c/{id}、/video/{id}）。改为保留中文路由
 * 原样不动，另加一套 /en/* 镜像路由，两边显式传入 locale，复用同一批组件。
 */
export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';

/** 该 locale 的路径前缀（zh 无前缀，与既有部署一致；en 加 /en）。 */
export function localePrefix(locale: Locale): string {
  return locale === 'en' ? '/en' : '';
}
