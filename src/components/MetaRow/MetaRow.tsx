import { Fragment, type ReactNode } from 'react';
import styles from './MetaRow.module.css';

export interface MetaRowProps {
  /** 元信息项（讲者 / 时长 / 主题等），以中点分隔渲染。 */
  items: ReactNode[];
  className?: string;
}

/**
 * MetaRow — 元信息行（design-spec §6.1）。
 * 等宽体基线，各项以中点「·」分隔；项本身可为文本或组件（DurationTag/Chip 等）。
 */
export function MetaRow({ items, className }: MetaRowProps) {
  const visible = items.filter((it) => it !== null && it !== undefined && it !== false);
  const cls = [styles.row, className].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {visible.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <span className={styles.sep} aria-hidden="true">
              ·
            </span>
          )}
          <span className={styles.item}>{item}</span>
        </Fragment>
      ))}
    </div>
  );
}
