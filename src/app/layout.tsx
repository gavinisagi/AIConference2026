import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

/**
 * 站点根布局。
 *
 * SITE_URL：部署域名（Railway 上设 NEXT_PUBLIC_SITE_URL）。metadataBase 决定
 * OG/Twitter 卡片里相对图片路径解析成的绝对地址——分享到 X / 小红书需要它。
 *
 * <html lang> 恒为 zh-CN：中文路由与 /en 镜像路由共用这一个根 layout（根 layout
 * 不在任何 [locale] 动态段下，拿不到 locale，见 src/i18n/locale.ts）。语言切换条、
 * 页脚翻译等 locale 相关内容下沉到 SiteChrome（各路由显式传入 locale 后渲染）。
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://ai-conference-compass.up.railway.app';
const SITE_NAME = 'AI Conference Compass';
const SITE_DESC =
  '把 AI 大会演讲扒成可读的观看导览：跨场信号、每场钩子与必看片段、逐段告诉你该看画面还是听就够，全部配官方原片时间戳深链。';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // 无 template：每个页面自己的 metadata.title 已经拼好完整标题（含站名后缀），
  // 若再套 layout 的 template 会把站名重复拼两遍（实测 /video/{id} 曾变成
  // "标题 · AI Conference 2026 Compass · AI Conference Compass"）。
  // default 仅作兜底——理论上不会用到，因为站内每个路由都显式设置了 title。
  title: `${SITE_NAME} — AI 大会观看导览`,
  description: SITE_DESC,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'zh_CN',
    url: SITE_URL,
    title: `${SITE_NAME} — AI 大会观看导览`,
    description: SITE_DESC,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — AI 大会观看导览`,
    description: SITE_DESC,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
