import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** hover 上浮 + 阴影（用于可点击进入详情/落地页的卡）。 */
  interactive?: boolean;
  /** 推荐先看卡：左侧 3px 强调条，全站视觉锚点（§3.5）。 */
  recommended?: boolean;
}

/**
 * Card — 基础卡片容器（design-spec §3.5）。
 * 8px 圆角、发丝线描边、纸面上的白表面；recommended 变体加左强调条。
 */
export function Card({
  children,
  interactive = false,
  recommended = false,
  className,
  ...rest
}: CardProps) {
  const cls = [
    styles.card,
    interactive && styles.interactive,
    recommended && styles.recommended,
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
