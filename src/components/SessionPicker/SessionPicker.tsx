'use client';

/**
 * SessionPicker — 首页选片器：facet 筛选 + 排序 + 结果列表。
 *
 * 为什么是客户端组件：筛选与排序是纯浏览态，不该产生 167×N 条静态路由，也不该
 * 把状态塞进 URL 再全量重建。
 *
 * 为什么 props 是「已算好的扁平行」而不是 Session[] + dict：函数不能跨
 * 服务端→客户端边界（词典里大量文案是插值函数）。故所有文案与派生值都在服务端
 * 算完，这里只做 filter / sort / 已读态，props 全部可序列化。
 *
 * 每行右侧的「必看 N min」是本站的核心承诺——它比「全片时长」更能帮人决定看不看，
 * 故给它最大的字号，全片时长退居其次。
 */
import { useMemo, useState } from 'react';
import { useSeen } from '@/lib/useSeen';
import styles from './SessionPicker.module.css';

/** 一条结果行所需的全部数据（服务端算好，纯可序列化）。 */
export interface PickerRow {
  id: string;
  href: string;
  /** 钩子（无导览时回落标题）。 */
  hook: string;
  /** 「讲者 · 会议名」。 */
  who: string;
  /** 「谁该看 · A / B」，无角色信息时为空串。 */
  roleText: string;
  /** 主题标签显示名。 */
  topicLabels: readonly string[];
  /** 盯屏分钟数；0 表示无导览数据，不渲染该栏。 */
  watchMinutes: number;
  /** 「全片 N min」，时长缺失时为空串。 */
  fullLengthText: string;
  /** 观看形态显示名（可当播客听 / 半听半看 / 需要盯屏）。 */
  shapeLabel: string;
  // --- 以下为筛选/排序键（不直接显示）---
  conferenceId: string;
  roleKeys: readonly string[];
  topicKeys: readonly string[];
  /** 命中的场景键（服务端按 watchStats 口径算好）。 */
  sceneKeys: readonly string[];
  /** 排序用：全片秒数（缺失记为极大值，排到最后）。 */
  durationSeconds: number;
  /** 排序用：会议内序号。 */
  playlistIndex: number;
}

/** 一组 facet 的可选项（值 + 显示名）。 */
export interface FacetOption {
  value: string;
  label: string;
}

/** 全部界面文案（纯字符串；带 {placeholder} 的由本组件替换）。 */
export interface PickerLabels {
  facetConference: string;
  facetScene: string;
  facetRole: string;
  facetTopic: string;
  all: string;
  /** 含 {shown} {total} 占位符。 */
  resultLine: string;
  emptyState: string;
  mustWatchMin: string;
  sortShortestWatch: string;
  sortShortestTotal: string;
  sortConferenceOrder: string;
}

const SORTS = ['shortestWatch', 'shortestTotal', 'conferenceOrder'] as const;
type Sort = (typeof SORTS)[number];

export interface SessionPickerProps {
  rows: readonly PickerRow[];
  /** 全站已发布总数（结果行的分母，不随筛选变化）。 */
  totalCount: number;
  conferences: readonly FacetOption[];
  scenes: readonly FacetOption[];
  roles: readonly FacetOption[];
  topics: readonly FacetOption[];
  labels: PickerLabels;
}

export function SessionPicker({
  rows,
  totalCount,
  conferences,
  scenes,
  roles,
  topics,
  labels,
}: SessionPickerProps) {
  const [conf, setConf] = useState<string | null>(null);
  const [scene, setScene] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('shortestWatch');
  const { seen, markSeen } = useSeen();

  const shown = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (conf && r.conferenceId !== conf) return false;
      if (role && !r.roleKeys.includes(role)) return false;
      if (topic && !r.topicKeys.includes(topic)) return false;
      if (scene && !r.sceneKeys.includes(scene)) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sort === 'shortestWatch') sorted.sort((a, b) => a.watchMinutes - b.watchMinutes);
    else if (sort === 'shortestTotal') sorted.sort((a, b) => a.durationSeconds - b.durationSeconds);
    else sorted.sort((a, b) => a.conferenceId.localeCompare(b.conferenceId) || a.playlistIndex - b.playlistIndex);
    return sorted;
  }, [rows, conf, role, topic, scene, sort]);

  const sortLabel: Record<Sort, string> = {
    shortestWatch: labels.sortShortestWatch,
    shortestTotal: labels.sortShortestTotal,
    conferenceOrder: labels.sortConferenceOrder,
  };

  return (
    <div className={styles.picker}>
      <div className={styles.facets}>
        <Facet label={labels.facetConference}>
          <Chip active={conf === null} onClick={() => setConf(null)} label={labels.all} />
          {conferences.map((o) => (
            <Chip key={o.value} active={conf === o.value} onClick={() => setConf(o.value)} label={o.label} />
          ))}
        </Facet>

        <Facet label={labels.facetScene}>
          <Chip active={scene === null} onClick={() => setScene(null)} label={labels.all} />
          {scenes.map((o) => (
            <Chip key={o.value} active={scene === o.value} onClick={() => setScene(o.value)} label={o.label} />
          ))}
        </Facet>

        {roles.length > 0 && (
          <Facet label={labels.facetRole}>
            <Chip active={role === null} onClick={() => setRole(null)} label={labels.all} />
            {roles.map((o) => (
              <Chip key={o.value} active={role === o.value} onClick={() => setRole(o.value)} label={o.label} />
            ))}
          </Facet>
        )}

        {topics.length > 0 && (
          <Facet label={labels.facetTopic}>
            <Chip active={topic === null} onClick={() => setTopic(null)} label={labels.all} />
            {topics.map((o) => (
              <Chip key={o.value} active={topic === o.value} onClick={() => setTopic(o.value)} label={o.label} />
            ))}
          </Facet>
        )}
      </div>

      <div className={styles.resultBar}>
        <span className={styles.resultLine}>
          {labels.resultLine
            .replace('{shown}', String(shown.length))
            .replace('{total}', String(totalCount))}
        </span>
        <div className={styles.sorts}>
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSort(s)}
              aria-pressed={sort === s}
              className={sort === s ? styles.sortActive : styles.sort}
            >
              {sortLabel[s]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className={styles.empty}>{labels.emptyState}</p>
      ) : (
        <ul className={styles.list}>
          {shown.map((r) => (
            <li key={r.id}>
              <a className={styles.row} href={r.href} onClick={() => markSeen(r.id)}>
                <span
                  className={seen.has(r.id) ? styles.dotSeen : styles.dotUnseen}
                  aria-hidden="true"
                />
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
                      <span className={styles.watchMinUnit}> {labels.mustWatchMin}</span>
                    </span>
                  )}
                  {r.fullLengthText && <span className={styles.fullLen}>{r.fullLengthText}</span>}
                  <span className={styles.shape}>{r.shapeLabel}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.facet}>
      <span className={styles.facetLabel}>{label}</span>
      <div className={styles.facetOptions}>{children}</div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={active ? styles.chipActive : styles.chip}
    >
      {label}
    </button>
  );
}
