import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getAllSessions,
  getSessionById,
  displayTitle,
  displayDuration,
  hasWhyWatch,
  displayDeepReadStatus,
} from '@/lib/loader';
import type { Session } from '@/lib/schema';
import { frameSrc } from '@/lib/assets';
import { conferenceMeta, topicMeta } from '@/design/tokens';
import { Button, Chip, ConfBadge, DurationTag, StatusBadge, TakeawayCard, TourView } from '@/components';
import { VideoCard } from '@/components/VideoCard/VideoCard';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import { ROLE_PRESETS } from '@/app/_landing/presets';
import styles from './detail.module.css';

/**
 * /video/{id} — 视频详情页（design-spec §6.2 / §8.4）。
 *
 * 全量预生成：generateStaticParams 覆盖数据集中每一个 session id（纯静态导出）。
 * 硬约束：本站不内嵌播放器，主行动为「在官方来源观看」外链（新标签 + rel=noopener）。
 * 缺省/降级：官方链接与基础元信息永远优先渲染；whyWatch / 观点卡缺失走诚实占位，不编造
 * （design-spec §7.1）。status=analyzing 走「解读中」占位，不空白。
 */
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
  if (!session) return { title: '视频详情 · AI Conference 2026 Compass' };
  const title = displayTitle(session);
  const description =
    session.whyWatch ?? '在官方来源观看这场 AI 大会 session。本站不播放，仅跳转官方。';

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

/** 官方来源深链：带时间戳跳到官方源具体时刻（design-spec §8.4，无时间戳则原链）。 */
function officialAt(url: string, seconds: number | null): string {
  if (seconds === null || seconds <= 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Math.floor(seconds)}s`;
}

/**
 * 导览锚点栏 —— 吸顶，用于在长导览页里跨区跳转。
 * 纯锚点无 JS（静态导出友好）；锚点目标靠 scroll-margin-top 避免被吸顶栏遮住。
 */
function TourNav({ session }: { session: Session }) {
  const items: Array<{ href: string; label: string }> = [];
  if (session.tour && session.tour.mustWatch.length > 0) items.push({ href: '#must', label: '必看片段' });
  if (session.frames.length > 0) items.push({ href: '#frames', label: '关键画面' });
  items.push({ href: '#time', label: '时间分配' });
  items.push({ href: '#stops', label: '逐段导览' });
  if (session.takeaways.length > 0) items.push({ href: '#takeaways', label: '关键观点' });
  // 只有一两个区块时导航没有价值，反而占位。
  if (items.length < 3) return null;

  return (
    <nav className={styles.tourNav} aria-label="导览分区">
      {items.map((it) => (
        <a key={it.href} href={it.href} className={styles.tourNavLink}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}

/** 相关推荐：优先同主题，回落同大会；排除自身，取前 6（design-spec §6.2）。 */
function relatedSessions(all: readonly Session[], current: Session): Session[] {
  const primaryTopic = current.topics[0];
  const pool = all.filter((s) => s.id !== current.id);
  let related = primaryTopic
    ? pool.filter((s) => s.topics.includes(primaryTopic))
    : [];
  if (related.length < 3) {
    const seen = new Set(related.map((s) => s.id));
    related = related.concat(
      pool.filter((s) => s.conferenceId === current.conferenceId && !seen.has(s.id)),
    );
  }
  return related.slice(0, 6);
}

export default async function VideoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSessionById(id);
  if (!session) notFound();

  const title = displayTitle(session);
  const primaryTopic = session.topics[0];
  const isAnalyzing = session.status === 'analyzing';
  const related = relatedSessions(getAllSessions(), session);

  // whyWatch 三态：已产出 → 展示；analyzing → 解读中占位；否则 → 诚实待产占位（§7.1）。
  const whyWatchBody = hasWhyWatch(session)
    ? session.whyWatch
    : isAnalyzing
      ? '深度解读整理中——本场正在解读，先看官方原片。'
      : '编辑深度解读整理中，可先看官方原片。';

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb
          items={[
            { label: '导览', href: '/' },
            { label: conferenceMeta[session.conferenceId].label },
            { label: title },
          ]}
        />

        <div className={session.tour ? styles.layoutSingle : styles.layout}>
          <article className={styles.main}>
            {/* 头部：标题 + 状态/来源/时长/主题 + 发布日期（§6.2）。 */}
            <header className={styles.head}>
              <div className={styles.badgeRow}>
                <ConfBadge conference={session.conferenceId} />
                <StatusBadge status={session.status} />
              </div>

              <h1 className={styles.title}>{title}</h1>

              <div className={styles.metaRow}>
                {session.durationSeconds !== null && session.durationMinutes !== null ? (
                  <DurationTag minutes={session.durationMinutes} />
                ) : (
                  <span className={styles.metaMuted}>时长未知</span>
                )}
                {session.publishedDate && (
                  <span className={styles.metaMono}>{session.publishedDate}</span>
                )}
                {session.speakers.length > 0 && (
                  <span className={styles.speaker}>
                    {session.speakers.map((sp) => sp.name).join(' · ')}
                  </span>
                )}
              </div>

              {session.topics.length > 0 && (
                <div className={styles.topics}>
                  {/* 主题筛选页在当前发布规模下已下线，chip 仅作标注不再外链。 */}
                  {session.topics.map((t) => (
                    <Chip key={t}>{topicMeta[t].label}</Chip>
                  ))}
                </div>
              )}
            </header>

            {/* 导览页可达 9000px+，长滚动中容易失去位置：给一条吸顶锚点栏用于跨区跳转。
                只列出该场真实存在的区块（无必看片段 / 无关键画面的场次不会出现死锚点）。 */}
            {session.tour && <TourNav session={session} />}

            {/* 观看导览：有 tour 时是本页核心体验，钩子 hero 第一眼（承接层）。 */}
            {session.tour && (
              <TourView tour={session.tour} officialUrl={session.officialUrl} frames={session.frames} />
            )}

            {/* 主行动：在官方来源观看（本站不播放，外链新标签 + noopener，§0/§6.2/§8.4）。 */}
            <section className={styles.actionBlock} aria-label="观看">
              <a
                href={session.officialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.watchLink}
              >
                <Button variant="primary">在官方来源观看 ↗</Button>
              </a>
              <p className={styles.watchNote}>本站不播放，跳转官方来源观看。</p>
            </section>

            {/* 为什么值得看：无 tour 时的核心增值；缺省走诚实占位（§6.2 / §7.1）。 */}
            {!session.tour && (
            <section className={styles.section} aria-labelledby="why-head">
              <h2 id="why-head" className={styles.sectionHead}>
                为什么值得看
              </h2>
              <p className={hasWhyWatch(session) ? styles.whyWatch : styles.whyWatchPending}>
                {whyWatchBody}
              </p>
            </section>
            )}

            {/* 关键观点（§6.1 观点卡复用）：真实 takeaways 缺失时不渲染，不编造（§7.1）。 */}
            {session.takeaways.length > 0 && (
              <section className={styles.section} id="takeaways" aria-labelledby="takeaways-head">
                <h2 id="takeaways-head" className={styles.sectionHead}>
                  关键观点
                </h2>
                <ul className={styles.takeawayList}>
                  {session.takeaways.map((tk) => (
                    <li key={tk.id}>
                      <TakeawayCard
                        conference={session.conferenceId}
                        status={session.status}
                        quote={tk.statement}
                        support={tk.context ?? undefined}
                        speaker={session.speakers[0]?.name ?? ''}
                        minutes={session.durationMinutes ?? 0}
                        topics={session.topics}
                        officialHref={officialAt(session.officialUrl, tk.timestampSeconds)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {/* 有 tour 时：元信息降级为一行精简脚注（弱化，不抢导览）。 */}
            {session.tour && (
              <footer className={styles.metaFoot}>
                <span>{conferenceMeta[session.conferenceId].label}</span>
                <span className={styles.metaFootDot}>·</span>
                <span>{displayDuration(session)}</span>
                {session.publishedDate && (
                  <>
                    <span className={styles.metaFootDot}>·</span>
                    <span className={styles.metaMono}>{session.publishedDate}</span>
                  </>
                )}
                <span className={styles.metaFootDot}>·</span>
                <a
                  href={session.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.sourceLink}
                >
                  官方视频 ↗
                </a>
              </footer>
            )}
          </article>

          {/* 元信息侧栏（无 tour 时）：大会/主题/时长/发布/角色/深度解读/来源（§6.2）。 */}
          {!session.tour && (
          <aside className={styles.aside} aria-label="元信息">
            <dl className={styles.metaList}>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>大会</dt>
                <dd className={styles.metaVal}>{conferenceMeta[session.conferenceId].label}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>主题</dt>
                <dd className={styles.metaVal}>
                  {session.topics.length > 0
                    ? session.topics.map((t) => topicMeta[t].label).join(' · ')
                    : '—'}
                </dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>时长</dt>
                <dd className={styles.metaVal}>{displayDuration(session)}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>发布日期</dt>
                <dd className={styles.metaVal}>{session.publishedDate ?? '—'}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>角色适配</dt>
                <dd className={styles.metaVal}>
                  {session.roles.length > 0
                    ? session.roles.map((r) => ROLE_PRESETS[r].name).join(' · ')
                    : '整理中'}
                </dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>深度解读</dt>
                <dd className={styles.metaVal}>{displayDeepReadStatus()}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>来源</dt>
                <dd className={styles.metaVal}>
                  <a
                    href={session.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sourceLink}
                  >
                    官方视频 ↗
                  </a>
                  {session.sourceUrl && (
                    <a
                      href={session.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.sourceLink}
                    >
                      官方频道 ↗
                    </a>
                  )}
                </dd>
              </div>
            </dl>
          </aside>
          )}
        </div>

        {/* 相关推荐：同主题/同大会 3–6 条，复用 VideoCard（§6.2）。 */}
        {related.length > 0 && (
          <section className={styles.relatedSection} aria-labelledby="related-head">
            <h2 id="related-head" className={styles.sectionHead}>
              相关推荐
            </h2>
            <ul className={styles.relatedGrid}>
              {related.map((s) => (
                <li key={s.id}>
                  <VideoCard session={s} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
