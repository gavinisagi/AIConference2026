import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getConferences } from '@/lib/loader';
import { isConferenceId } from '@/lib/schema';
import { ConferenceHub } from '@/components/ConferenceHub/ConferenceHub';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';

/**
 * /en/c/{conferenceId} — 英文镜像。中文原版见 src/app/c/[conferenceId]/page.tsx，
 * 逻辑完全一致，只是 locale='en'（非 [locale] 动态段方案，见 src/i18n/locale.ts）。
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
  if (!conf) return { title: 'Conference guide · AI Conference 2026 Compass' };
  return {
    title: `${conf.name} guide · AI Conference 2026 Compass`,
    description: `A watch guide for all ${conf.sessionCount} talks at ${conf.name}: this conference's signals, each talk's hook and must-watch clips, and a segment-by-segment call on whether to watch the screen or just listen.`,
  };
}

export default async function ConferenceHubPageEn({
  params,
}: {
  params: Promise<{ conferenceId: string }>;
}) {
  const { conferenceId } = await params;
  if (!isConferenceId(conferenceId)) notFound();
  if (!publishedConferences().some((c) => c.id === conferenceId)) notFound();

  return (
    <SiteChrome locale="en">
      <ConferenceHub conferenceId={conferenceId} locale="en" />
    </SiteChrome>
  );
}
