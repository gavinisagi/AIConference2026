/**
 * SessionRows — 只读行列表，复用 SessionPicker 的行样式。
 *
 * 相关推荐此前用 VideoCard（英文标题 + 三行摘要卡片），与主列表页的
 * 「中文钩子 + 单行」风格完全是两套视觉语言。这里直接复用同一份 PickerRow
 * 数据形状与 CSS，让"相关推荐"看起来像主列表的一个子集，而不是另一个产品。
 * 无筛选/排序/已读追踪需求，故是纯服务端组件，不需要 'use client'。
 */
import type { PickerRow } from './SessionPicker';
import styles from './SessionPicker.module.css';

export function SessionRows({ rows, mustWatchMinLabel }: { rows: readonly PickerRow[]; mustWatchMinLabel: string }) {
  return (
    <ul className={styles.list}>
      {rows.map((r) => (
        <li key={r.id}>
          <a className={styles.row} href={r.href}>
            <span className={styles.dotUnseen} aria-hidden="true" style={{ visibility: 'hidden' }} />
            <span className={styles.rowMain}>
              <span className={styles.hook}>{r.hook}</span>
              {r.who && <span className={styles.who}>{r.who}</span>}
            </span>
            <span className={styles.rowMid}>
              {r.roleText && <span className={styles.roleText}>{r.roleText}</span>}
              {r.topicLabels.length > 0 && (
                <span className={styles.topics}>
                  {r.topicLabels.map((t) => (
                    <span key={t} className={styles.topicTag}>
                      {t}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className={styles.rowEnd}>
              {r.watchMinutes > 0 && (
                <span className={styles.watchMin}>
                  {r.watchMinutes}
                  <span className={styles.watchMinUnit}> {mustWatchMinLabel}</span>
                </span>
              )}
              {r.fullLengthText && <span className={styles.fullLen}>{r.fullLengthText}</span>}
              <span className={styles.shape}>{r.shapeLabel}</span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
