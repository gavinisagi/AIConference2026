import {
  getAllSessions,
  displayTitle,
  displayDuration,
  hasWhyWatch,
  displayDeepReadStatus,
} from '@/lib/loader';
import type { Session } from '@/lib/schema';
import { conferenceMeta } from '@/design/tokens';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import { Button, Chip, ConfBadge, DurationTag, StatusBadge, TakeawayCard, TourView } from '@/components';
import { SessionRows } from '@/components/SessionPicker/SessionRows';
import { buildPickerProps } from '@/components/SessionPicker/buildPickerProps';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import styles from './VideoDetailView.module.css';

/**
 * VideoDetailView — /video/{id} 与 /en/video/{id} 共用的详情页主体。
 *
 * 全量预生成：两个路由各自的 generateStaticParams 覆盖数据集中每一个 session id
 * （纯静态导出）。硬约束：本站不内嵌播放器，主行动为「在官方来源观看」外链
 * （新标签 + rel=noopener）。缺省/降级：官方链接与基础元信息永远优先渲染；
 * whyWatch / 观点卡缺失走诚实占位，不编造（design-spec §7.1）。status=analyzing
 * 走「解读中」占位，不空白。
 *
 * locale 显式传入（非 [locale] 动态段方案，见 src/i18n/locale.ts），驱动 UI 框架
 * 文案；whyWatch/tour/takeaways 等 LLM 生成的中文正文不受 locale 影响。
 */

/** 官方来源深链：带时间戳跳到官方源具体时刻（design-spec §8.4，无时间戳则原链）。 */
function officialAt(url: string, seconds: number | null): string {
  if (seconds === null || seconds <= 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Math.floor(seconds)}s`;
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

export function VideoDetailView({ session, locale }: { session: Session; locale: Locale }) {
  const dict = getDictionary(locale);
  const title = displayTitle(session, dict);
  const isAnalyzing = session.status === 'analyzing';
  const related = relatedSessions(getAllSessions(locale), session);
  const homeHref = locale === 'en' ? '/en/' : '/';
  const confHref = locale === 'en' ? `/en/c/${session.conferenceId}/` : `/c/${session.conferenceId}/`;

  // whyWatch 三态：已产出 → 展示；analyzing → 解读中占位；否则 → 诚实待产占位（§7.1）。
  const whyWatchBody = hasWhyWatch(session)
    ? session.whyWatch
    : isAnalyzing
      ? dict.video.whyWatchAnalyzing
      : dict.video.whyWatchPending;

  // 中文钩子是本站的核心交付物，永远是最大的那行字；英文原标题退居等宽小字。
  // 无 tour 时没有钩子，回落到原标题作为唯一标题（不降级出空标题）。
  const hook = session.tour?.hook;
  const originalLine = [session.title, session.speakers[0]?.name].filter(Boolean).join(' · ');

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb
          ariaLabel={dict.breadcrumb.ariaLabel}
          items={[
            { label: dict.breadcrumb.home, href: homeHref },
            { label: conferenceMeta[session.conferenceId].label, href: confHref },
            { label: hook || title },
          ]}
        />

        <div className={session.tour ? styles.layoutSingle : styles.layout}>
          <article className={styles.main}>
            {/* 头部：标题 + 状态/来源/时长/主题 + 发布日期（§6.2）。 */}
            <header className={styles.head}>
              <div className={styles.badgeRow}>
                <ConfBadge conference={session.conferenceId} />
                <StatusBadge status={session.status} locale={locale} />
              </div>

              {/* 中文钩子是核心交付物，永远是本页最大的一行字；英文原标题退居
                  下方等宽小字（此前反过来，英文标题占了 h1，是本轮重设计要
                  解决的问题之一，实现时做反了——2026-08 修正）。 */}
              <h1 className={styles.title}>{hook || title}</h1>
              {hook && originalLine && <p className={styles.originalTitle}>{originalLine}</p>}

              <div className={styles.metaRow}>
                {session.durationSeconds !== null && session.durationMinutes !== null ? (
                  <DurationTag minutes={session.durationMinutes} />
                ) : (
                  <span className={styles.metaMuted}>{dict.video.durationUnknown}</span>
                )}
                {session.publishedDate && (
                  <span className={styles.metaMono}>{session.publishedDate}</span>
                )}
                {/* 有 hook 时讲者已并入原标题小字行（originalLine），这里不重复。 */}
                {!hook && session.speakers.length > 0 && (
                  <span className={styles.speaker}>
                    {session.speakers.map((sp) => sp.name).join(' · ')}
                  </span>
                )}
              </div>

              {session.topics.length > 0 && (
                <div className={styles.topics}>
                  {/* 主题筛选页在当前发布规模下已下线，chip 仅作标注不再外链。 */}
                  {session.topics.map((t) => (
                    <Chip key={t}>{dict.topics[t]}</Chip>
                  ))}
                </div>
              )}
            </header>

            {/* 观看导览：有 tour 时是本页核心体验，三档阅读深度承接一切
                （旧版吸顶锚点栏 TourNav 与三档 tab 并存会打架，已删除）。 */}
            {session.tour && (
              <TourView tour={session.tour} officialUrl={session.officialUrl} frames={session.frames} locale={locale} />
            )}

            {/* 主行动：在官方来源观看。有 tour 时「跳看原片」档已经给了同一个入口，
                这里重复一份反而是噪音，故只在无导览的降级页面出现（§0/§6.2/§8.4）。 */}
            {!session.tour && (
              <section className={styles.actionBlock} aria-label={dict.video.watchSectionAriaLabel}>
                <a
                  href={session.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.watchLink}
                >
                  <Button variant="primary">{dict.video.watchButton}</Button>
                </a>
                <p className={styles.watchNote}>{dict.video.watchNote}</p>
              </section>
            )}

            {/* 为什么值得看：无 tour 时的核心增值；缺省走诚实占位（§6.2 / §7.1）。 */}
            {!session.tour && (
            <section className={styles.section} aria-labelledby="why-head">
              <h2 id="why-head" className={styles.sectionHead}>
                {dict.video.whyWatchHeading}
              </h2>
              <p className={hasWhyWatch(session) ? styles.whyWatch : styles.whyWatchPending}>
                {whyWatchBody}
              </p>
            </section>
            )}

            {/* 关键观点（§6.1 观点卡复用）：真实 takeaways 缺失时不渲染，不编造（§7.1）。
                有 tour 时「30 秒结论」档已经给出经编辑重写的关键观点，这里的
                session.takeaways 是提取阶段的原始英文证据句，与之重复且质量更低，
                此前漏加 !session.tour 守卫导致两处同时出现，已修正。 */}
            {!session.tour && session.takeaways.length > 0 && (
              <section className={styles.section} id="takeaways" aria-labelledby="takeaways-head">
                <h2 id="takeaways-head" className={styles.sectionHead}>
                  {dict.video.takeawaysHeading}
                </h2>
                <ul className={styles.takeawayList}>
                  {session.takeaways.map((tk) => (
                    <li key={tk.id}>
                      <TakeawayCard
                        conference={session.conferenceId}
                        status={session.status}
                        locale={locale}
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
                  {dict.video.officialVideo}
                </a>
              </footer>
            )}
          </article>

          {/* 元信息侧栏（无 tour 时）：大会/主题/时长/发布/角色/深度解读/来源（§6.2）。 */}
          {!session.tour && (
          <aside className={styles.aside} aria-label={dict.video.metaAsideAriaLabel}>
            <dl className={styles.metaList}>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.conference}</dt>
                <dd className={styles.metaVal}>{conferenceMeta[session.conferenceId].label}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.topic}</dt>
                <dd className={styles.metaVal}>
                  {session.topics.length > 0
                    ? session.topics.map((t) => dict.topics[t]).join(' · ')
                    : '—'}
                </dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.duration}</dt>
                <dd className={styles.metaVal}>{displayDuration(session)}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.published}</dt>
                <dd className={styles.metaVal}>{session.publishedDate ?? '—'}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.role}</dt>
                <dd className={styles.metaVal}>
                  {session.roles.length > 0
                    ? session.roles.map((r) => dict.roles[r]).join(' · ')
                    : dict.video.roleFallback}
                </dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.deepRead}</dt>
                <dd className={styles.metaVal}>{displayDeepReadStatus(dict)}</dd>
              </div>
              <div className={styles.metaItem}>
                <dt className={styles.metaKey}>{dict.video.metaLabels.source}</dt>
                <dd className={styles.metaVal}>
                  <a
                    href={session.officialUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.sourceLink}
                  >
                    {dict.video.officialVideo}
                  </a>
                  {session.sourceUrl && (
                    <a
                      href={session.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.sourceLink}
                    >
                      {dict.video.officialChannel}
                    </a>
                  )}
                </dd>
              </div>
            </dl>
          </aside>
          )}
        </div>

        {/* 相关推荐：同主题/同大会 3–6 条。复用主列表的行样式（SessionRows），
            不再是另一套「英文标题 + 三行摘要」卡片——同一个产品只该有一套
            列表视觉语言（2026-08 修正）。 */}
        {related.length > 0 && (
          <section className={styles.relatedSection} aria-labelledby="related-head">
            <h2 id="related-head" className={styles.sectionHead}>
              {dict.video.relatedHeading}
            </h2>
            <SessionRows
              rows={buildPickerProps(related, dict, locale).rows}
              mustWatchMinLabel={dict.picker.mustWatchMin}
            />
          </section>
        )}
      </div>
    </main>
  );
}
