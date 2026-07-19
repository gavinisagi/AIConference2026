import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllSessions } from '@/lib/loader';
import { isTopic, TOPICS, type Topic } from '@/lib/schema';
import { LandingView } from '@/app/_landing/LandingView';
import { SessionGrid } from '@/app/_landing/SessionGrid';
import { TOPIC_PRESETS, sessionsForTopic } from '@/app/_landing/presets';

/**
 * /topic/{slug} — 主题落地页（design-spec §4.5 / §6.2）。
 *
 * 全枚举预生成（generateStaticParams 覆盖全部 TOPICS）。落地页 = 目录按该主题的预设筛选视图
 * + 一段编辑导语。主题为标题关键词近似归类，计数以「约」标注（design-spec §7.1，不读作精确编目）。
 */
export function generateStaticParams(): Array<{ slug: Topic }> {
  return TOPICS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isTopic(slug)) return { title: '主题 · AI Conference 2026 Compass' };
  const preset = TOPIC_PRESETS[slug];
  return {
    title: `${preset.name} · 主题 · AI Conference 2026 Compass`,
    description: preset.intro,
  };
}

export default async function TopicLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isTopic(slug)) notFound();

  const preset = TOPIC_PRESETS[slug];
  const sessions = sessionsForTopic(getAllSessions(), slug);

  return (
    <LandingView
      crumbs={[
        { label: '目录', href: '/catalog/' },
        { label: '主题' },
        { label: preset.name },
      ]}
      kicker="主题"
      title={preset.name}
      lede={preset.intro}
      metaLine={`约 ${sessions.length} 场 · 按标题关键词近似归类`}
    >
      <SessionGrid
        sessions={sessions}
        emptyTitle="这个主题暂时没有匹配的场次"
        emptyHint="主题为近似归类，仍在完善；先去完整目录看看。"
      />
    </LandingView>
  );
}
