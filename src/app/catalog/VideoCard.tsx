import { Card, Chip, ConfBadge, DurationTag, MetaRow, StatusBadge } from '@/components';
import { topicMeta } from '@/design/tokens';
import { displayTitle, hasWhyWatch } from '@/lib/loader';
import type { Session } from '@/lib/schema';
import styles from './VideoCard.module.css';

export interface VideoCardProps {
  session: Session;
}

/**
 * VideoCard — 目录列表项（design-spec §5.2 / §5.3）。
 *
 * 消费 T2 设计系统组件（Card/StatusBadge/ConfBadge/DurationTag/Chip/MetaRow），不重复造轮子。
 * 视觉重量三态分级：recommended（Card 左强调条 + ★ 徽章）> indexed（常规）> analyzing（进行中态）。
 * 整卡可点进详情（标题 stretched-link）；卡内「官方来源 ↗」阻止冒泡直达官方。
 */
export function VideoCard({ session }: VideoCardProps) {
  const title = displayTitle(session);
  const minutes = session.durationMinutes;

  // 时长缺失时不显示 DurationTag（不编造 0 min，design-spec §7.1 降级）。
  const durationNode =
    session.durationSeconds !== null && minutes !== null ? (
      <DurationTag minutes={minutes} />
    ) : (
      <span className={styles.durMissing}>时长未知</span>
    );

  return (
    <Card
      interactive
      recommended={session.status === 'recommended'}
      className={[styles.card, styles[session.status]].join(' ')}
    >
      <div className={styles.topRow}>
        <ConfBadge conference={session.conferenceId} />
        <StatusBadge status={session.status} />
      </div>

      <h3 className={styles.title}>
        {/* 整卡进详情：stretched-link 覆盖整卡；官方链接以更高 z-index 盖回。 */}
        <a className={styles.titleLink} href={`/video/${session.id}/`}>
          {title}
        </a>
      </h3>

      {/* 为什么值得看：真实 whyWatch 缺失时给出诚实占位，不编造编辑解读（§5.2 / §7.1）。 */}
      <p className={hasWhyWatch(session) ? styles.whyWatch : styles.whyWatchPending}>
        {hasWhyWatch(session)
          ? session.whyWatch
          : '编辑深度解读整理中 · 官方原片可直接观看'}
      </p>

      {session.topics.length > 0 && (
        <div className={styles.topics}>
          {session.topics.map((t) => (
            <Chip key={t}>{topicMeta[t].label}</Chip>
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
          官方来源 ↗
        </a>
      </div>
    </Card>
  );
}
