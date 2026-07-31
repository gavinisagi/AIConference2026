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
  // indexed 是"已产出基础清洗但尚无编辑推荐/分析标记"的默认态——当前全站
  // 167 场清一色 indexed，徽章逢卡必现、信息量为零，纯视觉噪音。只在真正
  // 有区分度的两态（推荐先看 / 解读中）时才渲染。
  if (status === 'indexed') return null;
  const cls = [styles.badge, styles[status], className].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {status === 'recommended' && (
        <span className={styles.star} aria-hidden="true">
          ★
        </span>
      )}
      {status === 'analyzing' && <span className={styles.pulse} aria-hidden="true" />}
      {dict.status[status]}
    </span>
  );
}
