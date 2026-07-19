import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import styles from './layout.module.css';

/**
 * 站点根布局。
 *
 * SITE_URL：部署域名（Railway 上设 NEXT_PUBLIC_SITE_URL）。metadataBase 决定
 * OG/Twitter 卡片里相对图片路径解析成的绝对地址——分享到 X / 小红书需要它。
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://ai-conference-compass.up.railway.app';
const SITE_NAME = 'AI Conference Compass';
const SITE_DESC =
  '把 AI 大会演讲扒成可读的观看导览：跨场信号、每场钩子与必看片段、逐段告诉你该看画面还是听就够，全部配官方原片时间戳深链。';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Cursor Compile 2026 观看导览`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    locale: 'zh_CN',
    url: SITE_URL,
    title: `${SITE_NAME} — Cursor Compile 2026 观看导览`,
    description: SITE_DESC,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} — Cursor Compile 2026 观看导览`,
    description: SITE_DESC,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // 中文优先（design-spec §1.4）；专有名词保留英文原文。
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {/* 归属与免责：本站为第三方导览，不隶属于任何主办方，内容以官方原片为准。 */}
        <footer className={styles.siteFoot}>
          <div className={styles.siteFootInner}>
            <p className={styles.footLine}>
              本站是<b>第三方观看导览</b>，与 Cursor、Figma、AI Engineer 及各主办方<b>无隶属关系</b>。
              所有演讲版权归原作者与主办方所有；本站不托管、不播放视频，仅提供指向官方原片的时间戳链接。
            </p>
            <p className={styles.footLine}>
              导览由自动流水线生成（语音转写 → 结构化提炼 → 人工抽检），每条观点均可回指原片具体时刻。
              可能存在转写或归纳误差，<b>请以官方原片为准</b>。
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
