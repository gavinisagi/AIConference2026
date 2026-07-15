import type { ReactNode } from 'react';
import styles from './Chip.module.css';

export interface ChipProps {
  children: ReactNode;
  /** 提供 href 则渲染为可点击链接（进入主题落地页，§3.6）。 */
  href?: string;
  className?: string;
}

/**
 * Chip — 主题标签（design-spec §3.6）。
 * 静态标签或可点击链接两种形态；纯识别 + 导航，不承载状态。
 */
export function Chip({ children, href, className }: ChipProps) {
  const cls = [styles.chip, className].filter(Boolean).join(' ');
  if (href) {
    return (
      <a className={cls} href={href}>
        {children}
      </a>
    );
  }
  return <span className={cls}>{children}</span>;
}
