/**
 * filters.ts — 目录页筛选 / 排序的纯逻辑层（design-spec §5.1 / §8.3）。
 *
 * 无 React、无 DOM 依赖：接收 session 数组 + 筛选状态，返回筛选后的结果。
 * 同时提供筛选状态 <-> URL query 的编解码，实现「可分享 / 可回退」。
 * 静态导出下，筛选 / 排序全部在客户端执行（任务约束）。
 */
import type { ConferenceId, Role, Session, SessionStatus, Topic } from '@/lib/schema';
import { CONFERENCE_IDS, ROLES, SESSION_STATUSES, TOPICS } from '@/lib/schema';

/** 时长分段（design-spec §5.1：`<15min` / `15–40min` / `>40min`，单选）。 */
export type DurationBucket = 'short' | 'mid' | 'long';

/** 排序键（design-spec §5.1 排序：默认「推荐优先」+「最新」「时长短→长」）。 */
export type SortKey = 'recommended' | 'newest' | 'duration-asc';

export const DEFAULT_SORT: SortKey = 'recommended';

/** 目录页完整筛选状态。数组类维度为多选；duration 为单选（可空）。 */
export interface FilterState {
  conf: ConferenceId[];
  role: Role[];
  topic: Topic[];
  duration: DurationBucket | null;
  status: SessionStatus[];
  sort: SortKey;
}

export const EMPTY_FILTERS: FilterState = {
  conf: [],
  role: [],
  topic: [],
  duration: null,
  status: [],
  sort: DEFAULT_SORT,
};

/** 时长分段边界（秒）。<15min = <900；15–40min = [900, 2400]；>40min = >2400。 */
function durationMatches(session: Session, bucket: DurationBucket): boolean {
  const sec = session.durationSeconds;
  // 无有效时长的记录不落入任何具体时长段（不编造归类，design-spec §7.1）。
  if (sec === null || sec <= 0) return false;
  const min = sec / 60;
  if (bucket === 'short') return min < 15;
  if (bucket === 'mid') return min >= 15 && min <= 40;
  return min > 40;
}

/** 单条 session 是否命中当前筛选（各维度之间取交集，维度内多选取并集）。 */
function passesFilters(session: Session, f: FilterState): boolean {
  if (f.conf.length > 0 && !f.conf.includes(session.conferenceId)) return false;
  if (f.status.length > 0 && !f.status.includes(session.status)) return false;
  if (f.role.length > 0 && !f.role.some((r) => session.roles.includes(r))) return false;
  if (f.topic.length > 0 && !f.topic.some((t) => session.topics.includes(t))) return false;
  if (f.duration !== null && !durationMatches(session, f.duration)) return false;
  return true;
}

// 排序权重：recommended 置顶并加重，analyzing 垫底（design-spec §5.1 / §5.3）。
const STATUS_RANK: Record<SessionStatus, number> = {
  recommended: 0,
  indexed: 1,
  analyzing: 2,
};

// 大会稳定次序（用于同权重时的确定性排序）。
const CONF_RANK: Record<ConferenceId, number> = {
  'ai-engineer': 0,
  'cursor-compile': 1,
  'figma-config': 2,
};

/** 稳定序：大会次序 + 播放列表序号 + id，保证任何排序下都确定、无跳动。 */
function stableOrder(a: Session, b: Session): number {
  const cr = CONF_RANK[a.conferenceId] - CONF_RANK[b.conferenceId];
  if (cr !== 0) return cr;
  const ai = a.playlistIndex ?? Number.MAX_SAFE_INTEGER;
  const bi = b.playlistIndex ?? Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compare(a: Session, b: Session, sort: SortKey): number {
  if (sort === 'duration-asc') {
    // 时长短→长；无时长记录排末尾（design-spec §7.1 降级）。
    const as = a.durationSeconds ?? Number.MAX_SAFE_INTEGER;
    const bs = b.durationSeconds ?? Number.MAX_SAFE_INTEGER;
    if (as !== bs) return as - bs;
    return stableOrder(a, b);
  }
  if (sort === 'newest') {
    // 发布日期倒序；当前语料 publishedDate 普遍缺失 → 回落稳定序（不编造时间）。
    const ad = a.publishedDate ?? '';
    const bd = b.publishedDate ?? '';
    if (ad !== bd) return ad < bd ? 1 : -1;
    return stableOrder(a, b);
  }
  // recommended：状态权重优先，其后稳定序。
  const sr = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (sr !== 0) return sr;
  return stableOrder(a, b);
}

/** 应用筛选 + 排序，返回新数组（不修改入参）。 */
export function applyFilters(sessions: readonly Session[], f: FilterState): Session[] {
  const filtered = sessions.filter((s) => passesFilters(s, f));
  filtered.sort((a, b) => compare(a, b, f.sort));
  return filtered;
}

/** 是否处于「无任何筛选」的默认态（排序不算筛选）。 */
export function hasActiveFilters(f: FilterState): boolean {
  return (
    f.conf.length > 0 ||
    f.role.length > 0 ||
    f.topic.length > 0 ||
    f.status.length > 0 ||
    f.duration !== null
  );
}

// ---------------------------------------------------------------------------
// URL query 编解码（design-spec §8.3：筛选状态写入 URL，可分享 / 可回退）
// ---------------------------------------------------------------------------

const DURATION_VALUES: readonly DurationBucket[] = ['short', 'mid', 'long'];
const SORT_VALUES: readonly SortKey[] = ['recommended', 'newest', 'duration-asc'];

function decodeList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const set = new Set(allowed as readonly string[]);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (set.has(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v as T);
    }
  }
  return out;
}

/** 从 URLSearchParams 解析筛选状态；未知 / 非法值一律忽略（防御性）。 */
export function decodeFilters(params: URLSearchParams): FilterState {
  const durationRaw = params.get('dur');
  const duration = DURATION_VALUES.includes(durationRaw as DurationBucket)
    ? (durationRaw as DurationBucket)
    : null;
  const sortRaw = params.get('sort');
  const sort = SORT_VALUES.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : DEFAULT_SORT;
  return {
    conf: decodeList(params.get('conf'), CONFERENCE_IDS),
    role: decodeList(params.get('role'), ROLES),
    topic: decodeList(params.get('topic'), TOPICS),
    duration,
    status: decodeList(params.get('status'), SESSION_STATUSES),
    sort,
  };
}

/** 序列化为 query 字符串（不含 `?`）；默认值省略，保持 URL 干净、可回退。 */
export function encodeFilters(f: FilterState): string {
  const params = new URLSearchParams();
  if (f.conf.length) params.set('conf', f.conf.join(','));
  if (f.role.length) params.set('role', f.role.join(','));
  if (f.topic.length) params.set('topic', f.topic.join(','));
  if (f.duration) params.set('dur', f.duration);
  if (f.status.length) params.set('status', f.status.join(','));
  if (f.sort !== DEFAULT_SORT) params.set('sort', f.sort);
  return params.toString();
}
