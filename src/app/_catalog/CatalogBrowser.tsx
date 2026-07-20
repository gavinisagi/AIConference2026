'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components';
import { conferenceMeta, statusMeta, topicMeta } from '@/design/tokens';
import type { ConferenceId, Role, Session, SessionStatus, Topic } from '@/lib/schema';
import { CONFERENCE_IDS, ROLES, SESSION_STATUSES, TOPICS } from '@/lib/schema';
import {
  applyFilters,
  DEFAULT_SORT,
  decodeFilters,
  encodeFilters,
  EMPTY_FILTERS,
  hasActiveFilters,
  type DurationBucket,
  type FilterState,
  type SortKey,
} from './filters';
import { VideoCard } from '@/components/VideoCard/VideoCard';
import styles from './CatalogBrowser.module.css';

/** 每页/每次加载的卡片数（design-spec §8.3 无限滚动 + 加载更多）。 */
const PAGE_SIZE = 24;

/** 角色展示名（design-spec §5.1）。当前语料角色标注为空 → 选中即空态，不编造归类。 */
const ROLE_LABELS: Record<Role, string> = {
  developer: '开发者',
  'product-design': '产品·设计',
  'founder-lead': '创始人·负责人',
  trend: '趋势',
};

const DURATION_OPTIONS: { value: DurationBucket; label: string }[] = [
  { value: 'short', label: '< 15 min' },
  { value: 'mid', label: '15–40 min' },
  { value: 'long', label: '> 40 min' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recommended', label: '推荐优先' },
  { value: 'newest', label: '最新' },
  { value: 'duration-asc', label: '时长短→长' },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export interface CatalogBrowserProps {
  /** 全量 941 场 session（构建期注入，客户端筛选/排序）。 */
  sessions: Session[];
  /** 各角色真实标注计数（0 时在筛选区标注「标注整理中」，不误导为可用维度）。 */
  roleCounts: Record<Role, number>;
}

/**
 * CatalogBrowser — 目录页交互主体（design-spec §5 / §8.3）。
 *
 * 静态导出下，全部筛选/排序在客户端执行；筛选状态写入 URL query（可分享/可回退）。
 * 首屏（SSR）以默认态渲染 941 场，hydration 后从 URL 回填筛选，避免闪烁与 hydration 失配。
 */
export function CatalogBrowser({ sessions, roleCounts }: CatalogBrowserProps) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [visible, setVisible] = useState(PAGE_SIZE);
  // 首帧后再显示 URL 驱动的更新动效，避免初次渲染即淡入。
  const hydratedRef = useRef(false);

  // 挂载：从 URL 回填筛选；并监听 popstate（分享链接/前进后退）。
  useEffect(() => {
    const readFromUrl = () => {
      setFilters(decodeFilters(new URLSearchParams(window.location.search)));
    };
    readFromUrl();
    window.addEventListener('popstate', readFromUrl);
    hydratedRef.current = true;
    return () => window.removeEventListener('popstate', readFromUrl);
  }, []);

  // 筛选变化：写回 URL（replaceState，保持可分享、不污染历史）+ 重置分页。
  useEffect(() => {
    if (!hydratedRef.current) return;
    const qs = encodeFilters(filters);
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
    setVisible(PAGE_SIZE);
  }, [filters]);

  const filtered = useMemo(() => applyFilters(sessions, filters), [sessions, filters]);
  const shown = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;
  const active = hasActiveFilters(filters);

  const clearAll = useCallback(() => {
    setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }));
  }, []);

  // 无限滚动：sentinel 进入视口即加载下一页；「加载更多」按钮为兜底（§8.3）。
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => v + PAGE_SIZE);
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, filtered.length]);

  return (
    <div className={styles.layout}>
      {/* -------- 筛选区（sticky 左栏 / 手机顶部）-------- */}
      <aside className={styles.filters} aria-label="筛选">
        <div className={styles.filtersHead}>
          <span className={styles.resultCount}>
            <strong>{filtered.length}</strong> 场结果
          </span>
          {active && (
            <button type="button" className={styles.clearInline} onClick={clearAll}>
              清除筛选
            </button>
          )}
        </div>

        <FilterGroup
          legend="大会"
          options={CONFERENCE_IDS.map((c) => ({ value: c, label: conferenceMeta[c].label }))}
          selected={filters.conf}
          onToggle={(v) => setFilters((f) => ({ ...f, conf: toggle(f.conf, v as ConferenceId) }))}
        />

        <FilterGroup
          legend="角色"
          note={
            ROLES.every((r) => (roleCounts[r] ?? 0) === 0)
              ? '角色标注整理中：选中将显示空态，标注补齐后即时生效'
              : undefined
          }
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          selected={filters.role}
          onToggle={(v) => setFilters((f) => ({ ...f, role: toggle(f.role, v as Role) }))}
        />

        <FilterGroup
          legend="主题"
          hint="约"
          options={TOPICS.map((t) => ({ value: t, label: topicMeta[t].label }))}
          selected={filters.topic}
          onToggle={(v) => setFilters((f) => ({ ...f, topic: toggle(f.topic, v as Topic) }))}
        />

        {/* 时长：单选段（design-spec §5.1）。 */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>时长</legend>
          <div className={styles.chips}>
            {DURATION_OPTIONS.map((opt) => {
              const on = filters.duration === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={on ? styles.chipOn : styles.chip}
                  aria-pressed={on}
                  onClick={() =>
                    setFilters((f) => ({ ...f, duration: on ? null : opt.value }))
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <FilterGroup
          legend="状态"
          options={SESSION_STATUSES.map((s) => ({ value: s, label: statusMeta[s].label }))}
          selected={filters.status}
          onToggle={(v) =>
            setFilters((f) => ({ ...f, status: toggle(f.status, v as SessionStatus) }))
          }
        />
      </aside>

      {/* -------- 结果区 -------- */}
      <div className={styles.results}>
        <div className={styles.resultsBar}>
          <span className={styles.resultsCount}>
            共 <strong>{filtered.length}</strong> 场
          </span>
          <label className={styles.sort}>
            <span className={styles.sortLabel}>排序</span>
            <select
              className={styles.sortSelect}
              value={filters.sort}
              onChange={(e) =>
                setFilters((f) => ({ ...f, sort: (e.target.value as SortKey) || DEFAULT_SORT }))
              }
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 空态始终存在于 DOM（hidden 切换），保证导出 HTML 含空态文案（design-spec §7.1）。 */}
        <div className={styles.empty} hidden={filtered.length > 0}>
          <p className={styles.emptyTitle}>没有匹配项，试试放宽筛选</p>
          <Button variant="secondary" onClick={clearAll}>
            清除筛选
          </Button>
        </div>

        <ul className={styles.grid} hidden={filtered.length === 0}>
          {shown.map((s) => (
            <li key={s.id} className={styles.gridItem}>
              <VideoCard session={s} />
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className={styles.loadMore}>
            <div ref={sentinelRef} aria-hidden="true" className={styles.sentinel} />
            <Button variant="secondary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              加载更多（还有 {filtered.length - visible} 场）
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 多选筛选组（chip 切换，design-spec §8.3）
// ---------------------------------------------------------------------------

interface FilterGroupProps<T extends string> {
  legend: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  /** 计数近似标注（如主题「约」）。 */
  hint?: string;
  /** 维度整体说明（如角色标注缺失）。 */
  note?: string;
}

function FilterGroup<T extends string>({
  legend,
  options,
  selected,
  onToggle,
  hint,
  note,
}: FilterGroupProps<T>) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>
        {legend}
        {hint && <span className={styles.hint}>{hint}</span>}
      </legend>
      {note && <p className={styles.note}>{note}</p>}
      <div className={styles.chips}>
        {options.map((opt) => {
          const on = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              className={on ? styles.chipOn : styles.chip}
              aria-pressed={on}
              onClick={() => onToggle(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
