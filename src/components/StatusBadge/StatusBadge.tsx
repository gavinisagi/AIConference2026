import { statusMeta, type VideoStatus } from '@/design/tokens';
import styles from './StatusBadge.module.css';

export interface StatusBadgeProps {
  status: VideoStatus;
  className?: string;
}

/**
 * StatusBadge — 三态视频状态徽章（design-spec §3.2）。
 * 三态视觉必须可区分：recommended 配 ★、indexed 配静态圆点、analyzing 配脉冲点。
 * recommended 为全站视觉锚点。
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cls = [styles.badge, styles[status], className].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {status === 'recommended' && (
        <span className={styles.star} aria-hidden="true">
          ★
        </span>
      )}
      {status === 'indexed' && <span className={styles.dot} aria-hidden="true" />}
      {status === 'analyzing' && <span className={styles.pulse} aria-hidden="true" />}
      {statusMeta[status].label}
    </span>
  );
}
