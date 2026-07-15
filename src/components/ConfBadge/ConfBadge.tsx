import type { CSSProperties } from 'react';
import { conferenceMeta, type Conference } from '@/design/tokens';
import styles from './ConfBadge.module.css';

export interface ConfBadgeProps {
  conference: Conference;
  className?: string;
}

/** 大会 -> theme.css 中对应的色标 CSS 变量名（避免在 JSX 内联 hex）。 */
const confDotVar: Record<Conference, string> = {
  'ai-engineer': 'var(--conf-ai-engineer)',
  'cursor-compile': 'var(--conf-cursor-compile)',
  'figma-config': 'var(--conf-figma-config)',
};

/**
 * ConfBadge — 大会色标（design-spec §3.6）。
 * 6px 圆点（大会色）+ 大会名。仅识别用途，禁止大面积铺色。
 */
export function ConfBadge({ conference, className }: ConfBadgeProps) {
  const cls = [styles.badge, className].filter(Boolean).join(' ');
  const dotStyle = { '--conf-dot': confDotVar[conference] } as CSSProperties;
  return (
    <span className={cls}>
      <span className={styles.dot} style={dotStyle} aria-hidden="true" />
      {conferenceMeta[conference].label}
    </span>
  );
}
