import type { VideoStatus } from '@/design/tokens';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import styles from './StatusBadge.module.css';

export interface StatusBadgeProps {
  status: VideoStatus;
  /** 缺省 zh——仅为已退役页面（src/app/_*）兼容，实际路由一律显式传入。 */
  locale?: Locale;
  className?: string;
}

/**
 * StatusBadge — 三态视频状态徽章（design-spec §3.2）。
 * 三态视觉必须可区分：recommended 配 ★、indexed 配静态圆点、analyzing 配脉冲点。
 * recommended 为全站视觉锚点。
 */
export function StatusBadge({ status, locale = 'zh', className }: StatusBadgeProps) {
  const dict = getDictionary(locale);
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
      {dict.status[status]}
    </span>
  );
}
