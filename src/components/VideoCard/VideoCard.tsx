import { Card, Chip, ConfBadge, DurationTag, MetaRow, StatusBadge } from '@/components';
import { displayTitle, hasWhyWatch } from '@/lib/loader';
import type { Session } from '@/lib/schema';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import styles from './VideoCard.module.css';

export interface VideoCardProps {
  session: Session;
  /** 缺省 zh——仅为已退役页面（src/app/_*）兼容，实际路由一律显式传入。 */
  locale?: Locale;
}

/**
 * VideoCard — 目录列表项（design-spec §5.2 / §5.3）。
 *
 * 消费 T2 设计系统组件（Card/StatusBadge/ConfBadge/DurationTag/Chip/MetaRow），不重复造轮子。
 * 视觉重量三态分级：recommended（Card 左强调条 + ★ 徽章）> indexed（常规）> analyzing（进行中态）。
 * 整卡可点进详情（标题 stretched-link）；卡内「官方来源 ↗」阻止冒泡直达官方。
 */
export function VideoCard({ session, locale = 'zh' }: VideoCardProps) {
  const dict = getDictionary(locale);
  const title = displayTitle(session, dict);
  const minutes = session.durationMinutes;
  const videoHref = locale === 'en' ? `/en/video/${session.id}/` : `/video/${session.id}/`;

  // 时长缺失时不显示 DurationTag（不编造 0 min，design-spec §7.1 降级）。
  const durationNode =
    session.durationSeconds !== null && minutes !== null ? (
      <DurationTag minutes={minutes} />
    ) : (
      <span className={styles.durMissing}>{dict.videoCard.durationUnknown}</span>
    );

  return (
    <Card
      interactive
      recommended={session.status === 'recommended'}
      className={[styles.card, styles[session.status]].join(' ')}
    >
      <div className={styles.topRow}>
        <ConfBadge conference={session.conferenceId} />
        <StatusBadge status={session.status} locale={locale} />
      </div>

      <h3 className={styles.title}>
        {/* 整卡进详情：stretched-link 覆盖整卡；官方链接以更高 z-index 盖回。 */}
        <a className={styles.titleLink} href={videoHref}>
          {title}
        </a>
      </h3>

      {/* 为什么值得看：真实 whyWatch 缺失时给出诚实占位，不编造编辑解读（§5.2 / §7.1）。 */}
      <p className={hasWhyWatch(session) ? styles.whyWatch : styles.whyWatchPending}>
        {hasWhyWatch(session) ? session.whyWatch : dict.videoCard.whyWatchPending}
      </p>

      {session.topics.length > 0 && (
        <div className={styles.topics}>
          {session.topics.map((t) => (
            <Chip key={t}>{dict.topics[t]}</Chip>
          ))}
        </div>
      )}

      <MetaRow className={styles.meta} items={[durationNode]} />

      <div className={styles.actions}>
        <a
          className={styles.officialLink}
          href={session.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {dict.videoCard.officialSource}
        </a>
      </div>
    </Card>
  );
}
