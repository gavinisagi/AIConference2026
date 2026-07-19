import Link from 'next/link';
import type { Session } from '@/lib/schema';
import { VideoCard } from '@/app/catalog/VideoCard';
import styles from './landing.module.css';

export interface SessionGridProps {
  sessions: readonly Session[];
  /** 空态标题（无匹配项时）。 */
  emptyTitle: string;
  /** 空态副文案（给出诚实出口）。 */
  emptyHint: string;
}

/**
 * SessionGrid — 落地页视频卡网格（复用 T4 的 VideoCard，design-spec §5.3 / §6.2）。
 *
 * 有结果：手机 1 列 / 桌面 2 列的 VideoCard 网格。
 * 无结果：空态卡（§7.1），给出「去完整目录」的真实出口，不编造清单。
 */
export function SessionGrid({ sessions, emptyTitle, emptyHint }: SessionGridProps) {
  if (sessions.length === 0) {
    return (
      <div className={styles.empty} role="status">
        <p className={styles.emptyTitle}>{emptyTitle}</p>
        <p className={styles.emptyHint}>{emptyHint}</p>
        <div className={styles.emptyActions}>
          <Link href="/catalog/" className={styles.emptyLink}>
            去完整目录 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <ul className={styles.grid}>
      {sessions.map((session) => (
        <li key={session.id}>
          <VideoCard session={session} />
        </li>
      ))}
    </ul>
  );
}
