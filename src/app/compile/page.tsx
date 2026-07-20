import type { Metadata } from 'next';
import { CompileHub } from './CompileHub';

/** /compile — 会议导览 hub（与首页共用 CompileHub，保留该路径供直达与既有链接）。 */
export const metadata: Metadata = {
  title: 'Cursor Compile 导览 · AI Conference Compass',
  description:
    'Cursor Compile 2026 全部演讲的观看导览：这届大会的 7 个信号、每场的钩子与必看片段、逐段告诉你该看画面还是听就够。',
};

export default function CompileHubPage() {
  return <CompileHub />;
}
