import styles from './DurationTag.module.css';

export interface DurationTagProps {
  /** 时长（分钟）。 */
  minutes: number;
  className?: string;
}

/** 分钟 -> 展示文案：`18 min` / `1 h 02`（design-spec §3.6）。 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/**
 * DurationTag — 时长标（design-spec §3.6）。
 * 等宽体 + 时钟微图标（线性 1.5px 描边，随文本色）。
 */
export function DurationTag({ minutes, className }: DurationTagProps) {
  const cls = [styles.tag, className].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {formatDuration(minutes)}
    </span>
  );
}
