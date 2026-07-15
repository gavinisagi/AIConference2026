/**
 * loader.ts — 只读数据加载层。
 *
 * 站点所有页面消费规范化数据的唯一入口。纯构建期读取（import 静态 JSON），
 * 无后端、无数据库、无运行时抓取（design-spec §7 / 任务约束）。
 *
 * 防御性降级：加载时过滤掉不满足最小必填契约的坏记录（isValidSession），
 * 并对可缺省字段提供安全兜底，任何字段缺失走降级而非抛错——页面永不白屏。
 * 权威的全量 schema 校验发生在构建期（scripts/build-data.mjs --verify，由
 * scripts/check 触发）。
 */
import rawDataset from '@/data/dataset.json';
import {
  type Conference,
  type ConferenceId,
  type NormalizedDataset,
  type Role,
  type Session,
  type SiteStats,
  type Topic,
  type TopicCount,
  isValidSession,
} from '@/lib/schema';

// dataset.json 由构建期生成并通过 schema 校验；此处仍做防御性过滤。
const dataset = rawDataset as unknown as NormalizedDataset;

const SESSIONS: readonly Session[] = Object.freeze(
  (Array.isArray(dataset.sessions) ? dataset.sessions : []).filter(isValidSession),
);

const SESSIONS_BY_ID: ReadonlyMap<string, Session> = new Map(SESSIONS.map((s) => [s.id, s]));

const CONFERENCES: readonly Conference[] = Object.freeze(
  Array.isArray(dataset.conferences) ? dataset.conferences : [],
);

const CONFERENCES_BY_ID: ReadonlyMap<string, Conference> = new Map(
  CONFERENCES.map((c) => [c.id, c]),
);

// --- 统计口径（缺省时给出安全兜底，UI 再决定是否显示 — 占位）。 ---
const EMPTY_STATS: SiteStats = {
  totalSessions: 0,
  totalDurationSeconds: 0,
  totalHours: 0,
  withDuration: 0,
  deepReadCount: 0,
  byConference: {},
  topicCounts: [],
};

const STATS: SiteStats = dataset.stats ?? EMPTY_STATS;

// ---------------------------------------------------------------------------
// 只读访问器
// ---------------------------------------------------------------------------

/** 全部有效 session（已过滤坏记录）。 */
export function getAllSessions(): readonly Session[] {
  return SESSIONS;
}

/** 按 id 取单条 session；不存在返回 undefined。 */
export function getSessionById(id: string): Session | undefined {
  return SESSIONS_BY_ID.get(id);
}

/** 全部大会（含色标与场次数）。 */
export function getConferences(): readonly Conference[] {
  return CONFERENCES;
}

/** 按 id 取大会；不存在返回 undefined。 */
export function getConferenceById(id: string): Conference | undefined {
  return CONFERENCES_BY_ID.get(id);
}

/** 站点统计口径（totalSessions=941 / totalHours=409）。 */
export function getSiteStats(): SiteStats {
  return STATS;
}

/** 主题近似计数（须以「约」标注展示）。 */
export function getTopicCounts(): readonly TopicCount[] {
  return STATS.topicCounts ?? [];
}

/** 按大会筛选。 */
export function getSessionsByConference(conferenceId: ConferenceId): readonly Session[] {
  return SESSIONS.filter((s) => s.conferenceId === conferenceId);
}

/** 按主题筛选（主题为近似归类）。 */
export function getSessionsByTopic(topic: Topic): readonly Session[] {
  return SESSIONS.filter((s) => s.topics.includes(topic));
}

/** 按角色筛选（当前角色标注为空 → 返回空数组，优雅降级）。 */
export function getSessionsByRole(role: Role): readonly Session[] {
  return SESSIONS.filter((s) => s.roles.includes(role));
}

// ---------------------------------------------------------------------------
// 降级辅助（供 UI 直接使用，避免各页面各写一套兜底）
// ---------------------------------------------------------------------------

/** 标题展示兜底：源标题为空时给出占位（不编造内容，仅标注未命名）。 */
export function displayTitle(session: Session): string {
  const t = session.title.trim();
  return t.length > 0 ? t : '（未命名 session）';
}

/**
 * 时长展示（等宽体口径，design-spec §3.6）：`18 min` / `1 h 02`。
 * 无有效时长时降级为 `—`（design-spec §7.1 统计条降级）。
 */
export function displayDuration(session: Session): string {
  const sec = session.durationSeconds;
  if (sec === null || sec <= 0) return '—';
  const totalMin = Math.round(sec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

/** 是否已有编辑深度解读（whyWatch）。当前全站为 false。 */
export function hasWhyWatch(session: Session): boolean {
  return typeof session.whyWatch === 'string' && session.whyWatch.length > 0;
}

/**
 * 深度解读展示口径：已产出条数为 0 时返回 '进行中'（design-spec §4.1/§5.1），
 * 否则返回条数字符串——不编造占位数。
 */
export function displayDeepReadStatus(): string {
  return STATS.deepReadCount > 0 ? String(STATS.deepReadCount) : '进行中';
}
