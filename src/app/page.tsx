import type { Metadata } from 'next';
import { CompileHub } from '@/app/compile/CompileHub';

/**
 * / — 站点首页。
 *
 * 上线范围收敛到 Cursor Compile（发布开关见 data/publish.json 与 DB 的 is_published），
 * 因此首页直接是该会议的导览体验：先给「这届大会发生了什么」的信号层，再给逐场导览。
 * 后续开放更多会议时，这里换成多会议入口即可，CompileHub 不变。
 */
export const metadata: Metadata = {
  title: 'AI Conference Compass — Cursor Compile 2026 观看导览',
  description:
    '把 Cursor Compile 2026 扒成可读的导览：7 个跨场信号、每场的钩子与必看片段、逐段告诉你该看画面还是听就够，全部配官方原片时间戳深链。',
};

export default function HomePage() {
  return <CompileHub asHome />;
}
