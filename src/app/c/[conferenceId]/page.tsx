import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getConferences } from '@/lib/loader';
import { isConferenceId } from '@/lib/schema';
import { ConferenceHub } from '@/components/ConferenceHub/ConferenceHub';

/**
 * /c/{conferenceId} — 会议导览 hub，泛化路由。
 *
 * 一场会议只要有 ≥1 已发布场次（data/publish.json / DB is_published）就会在此
 * 自动生成页面——新开一场会议无需新写路由或组件，重跑 build-data 即可。
 * 取代此前硬编码在 /compile 的做法（历史见 src/app/_compile/）。
 */

function publishedConferences() {
  return getConferences().filter((c) => c.sessionCount > 0);
}

export function generateStaticParams(): Array<{ conferenceId: string }> {
  return publishedConferences().map((c) => ({ conferenceId: c.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ conferenceId: string }>;
}): Promise<Metadata> {
  const { conferenceId } = await params;
  const conf = publishedConferences().find((c) => c.id === conferenceId);
  if (!conf) return { title: '会议导览 · AI Conference 2026 Compass' };
  return {
    title: `${conf.name} 导览 · AI Conference 2026 Compass`,
    description: `${conf.name} 全部 ${conf.sessionCount} 场演讲的观看导览：这届大会的信号、每场的钩子与必看片段、逐段告诉你该看画面还是听就够。`,
  };
}

export default async function ConferenceHubPage({
  params,
}: {
  params: Promise<{ conferenceId: string }>;
}) {
  const { conferenceId } = await params;
  if (!isConferenceId(conferenceId)) notFound();
  // 未发布（无场次）的会议不渲染空壳页——与静态生成集合保持一致。
  if (!publishedConferences().some((c) => c.id === conferenceId)) notFound();

  return <ConferenceHub conferenceId={conferenceId} />;
}
