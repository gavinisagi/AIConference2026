import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllSessions, getSessionById, displayTitle } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { frameSrc } from '@/lib/assets';
import { VideoDetailView } from '@/components/VideoDetailView/VideoDetailView';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';

/**
 * /video/{id} — 视频详情页（中文，默认 locale）。英文镜像见
 * /en/video/{id}（src/app/en/video/[id]/page.tsx）。两者共用
 * VideoDetailView，只是显式传入不同 locale。
 */
const dict = getDictionary('zh');

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
  // 中文钩子是核心交付物，社交卡片/搜索结果标题也该用它，不是英文原标题
  // （与页面 h1 同一优先级，见 VideoDetailView.tsx）。
  const title = session.tour?.hook || displayTitle(session, dict);
  const description = session.whyWatch ?? dict.video.defaultDescription;

  // 单场 OG 封面：优先用该场留存的首张关键画面（16:9 真实内容，比通用图更有点击欲）；
  // 无画面回落站点通用 og.png。相对 /frames 路径由 metadataBase 解析成绝对地址；配了
  // R2 base 时 frameSrc() 直接给出绝对 R2 URL。爬虫要绝对 URL，两种情况都成立。
  const cover = session.frames[0];
  const ogImage = cover
    ? { url: frameSrc(cover.src), width: 960, height: 540, alt: cover.caption || title }
    : { url: '/og.png', width: 1200, height: 630, alt: title };

  return {
    title: `${title} · AI Conference 2026 Compass`,
    description,
    alternates: {
      languages: { 'zh-CN': `/video/${session.id}/`, en: `/en/video/${session.id}/` },
    },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/video/${session.id}/`,
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

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSessionById(id);
  if (!session) notFound();

  return (
    <SiteChrome locale="zh">
      <VideoDetailView session={session} locale="zh" />
    </SiteChrome>
  );
}
