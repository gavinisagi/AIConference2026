import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllSessions, getSessionById, displayTitle } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { frameSrc } from '@/lib/assets';
import { VideoDetailView } from '@/components/VideoDetailView/VideoDetailView';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';

/**
 * /en/video/{id} — 英文镜像。中文原版见 src/app/video/[id]/page.tsx，
 * 逻辑完全一致，只是 locale='en'（非 [locale] 动态段方案，见 src/i18n/locale.ts）。
 */
const dict = getDictionary('en');

export function generateStaticParams(): Array<{ id: string }> {
  return getAllSessions().map((s) => ({ id: s.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const session = getSessionById(id);
  if (!session) return { title: dict.video.notFoundTitle };
  const title = displayTitle(session, dict);
  const description = session.whyWatch ?? dict.video.defaultDescription;

  const cover = session.frames[0];
  const ogImage = cover
    ? { url: frameSrc(cover.src), width: 960, height: 540, alt: cover.caption || title }
    : { url: '/og.png', width: 1200, height: 630, alt: title };

  return {
    title: `${title} · AI Conference 2026 Compass`,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/en/video/${session.id}/`,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage.url],
    },
  };
}

export default async function VideoDetailPageEn({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSessionById(id);
  if (!session) notFound();

  return (
    <SiteChrome locale="en">
      <VideoDetailView session={session} locale="en" />
    </SiteChrome>
  );
}
