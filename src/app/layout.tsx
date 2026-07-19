import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Conference 2026 Compass',
  description:
    'A static guide to AI Conference 2026 sessions. Videos link out to their official sources.',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // 中文优先（design-spec §1.4）；专有名词保留英文原文。
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
