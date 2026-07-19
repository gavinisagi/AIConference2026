/**
 * schema.ts — 站点消费的规范化内容数据模型（TypeScript 类型契约）。
 *
 * 对齐 design-spec §2.3（Video/Session、Takeaway、Conference，以及 status/role/topic
 * 枚举）。本文件是站点侧类型的“单一事实来源”，与 scripts/build-data.mjs（生成侧）
 * 和 docs/data-contract.md（人读契约）三者保持一致。
 *
 * 该 schema 即董事会“视频清洗产出”与“网站消费”之间的共享对齐基准。
 *
 * 缺省/降级原则（详见 docs/data-contract.md §缺省与降级）：
 *   - 必填且不可编造：id / conferenceId / officialUrl（缺失则该记录不入库，绝不伪造）。
 *   - 可降级：durationSeconds/publishedDate/thumbnailUrl 缺失 → null；
 *     whyWatch 缺失 → null（UI 显示官方原片占位，不编造解读）；
 *     speakers / takeaways / roles / topics 缺失 → []（不显示编造角标/计数）。
 */

// ---------------------------------------------------------------------------
// 枚举（as const → 既作运行时集合，也作字面量联合类型）
// ---------------------------------------------------------------------------

/** 视频状态（design-spec §2.3 / §3.2）。 */
export const SESSION_STATUSES = ['recommended', 'indexed', 'analyzing'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** 角色（design-spec §2.3）。 */
export const ROLES = ['developer', 'product-design', 'founder-lead', 'trend'] as const;
export type Role = (typeof ROLES)[number];

/** 主题（design-spec §2.3）。 */
export const TOPICS = ['agent', 'ai-coding', 'evals', 'context', 'design-to-code', 'ai-product'] as const;
export type Topic = (typeof TOPICS)[number];

/** 大会标识。 */
export const CONFERENCE_IDS = ['ai-engineer', 'cursor-compile', 'figma-config'] as const;
export type ConferenceId = (typeof CONFERENCE_IDS)[number];

// ---------------------------------------------------------------------------
// 内容对象
// ---------------------------------------------------------------------------

/** 大会（design-spec §2.3 名称 + §3.2 色标）。 */
export interface Conference {
  id: ConferenceId;
  /** 展示名（保留英文原文，见 design-spec §1.4）。 */
  name: string;
  /** 识别色标（仅识别，不铺色，见 design-spec §3.2）。 */
  colorHex: string;
  /** 官方来源页（频道/播放列表）。 */
  officialUrl: string;
  /** 该大会已收录场次数（派生自真实语料）。 */
  sessionCount: number;
}

/**
 * 观点卡（design-spec §2.3 / §6.1）。当前真实数据为 0 条——类型已就绪，
 * 数据为空并优雅降级，不得编造。
 */
export interface Takeaway {
  id: string;
  /** 所属 Session id。 */
  sessionId: string;
  /** 一句话观点（编辑提炼结论，卡片主角）。 */
  statement: string;
  /** 支撑上下文（可空）。 */
  context: string | null;
  /** 官方源深链时刻（秒，可空）。 */
  timestampSeconds: number | null;
  /** 适用角色（可空数组）。 */
  roles: Role[];
}

/** 讲者（design-spec §2.3）。当前语料无可靠讲者字段，全部为空数组待真实标注。 */
export interface Speaker {
  name: string;
  /** 所属组织（可空）。 */
  org: string | null;
}

/** 导览的观看模式：看画面 / 略读 / 听即可（依据画面内容与运动强度判定）。 */
export const TOUR_MODES = ['watch', 'skim', 'listen'] as const;
export type TourMode = (typeof TOUR_MODES)[number];

/** 导览的一站（章节级）：一段时间范围 + 讲了什么 + 关键点 + 怎么看。 */
export interface TourStop {
  startSeconds: number;
  endSeconds: number;
  title: string;
  what: string;
  keyPoint: string;
  howTo: TourMode;
  howToReason: string;
  speaker: string;
}

/** 必看片段：值得优先跳看的时间块（live=现场实操）。 */
export interface TourMustWatch {
  startSeconds: number;
  endSeconds: number;
  label: string;
  live: boolean;
  why: string;
}

/**
 * 观看导览（承接层核心资产）——不是 summary，是「推荐别人看」的观看指南。
 * 由清洗流水线 tour 阶段产出，缺省为 null（页面走详情降级）。
 */
export interface Tour {
  /** 一句话钩子（feed 也会复用）。 */
  hook: string;
  /** 谁最该看。 */
  whoShouldWatch: string;
  /** 时间不够看哪段。 */
  ifShortOnTime: string;
  mustWatch: TourMustWatch[];
  stops: TourStop[];
}

/** Video/Session — 站点消费的核心记录（design-spec §2.3 / §5.2）。 */
export interface Session {
  /** 稳定唯一 id（源自 YouTube video_id）。 */
  id: string;
  /** 标题（可能为空字符串；UI 用 displayTitle 兜底占位，见 loader）。 */
  title: string;
  /** 所属大会。 */
  conferenceId: ConferenceId;
  /** 官方观看链接（本站不播放，仅跳转，见 design-spec §0/§6.2）。 */
  officialUrl: string;
  /** 来源页链接（频道/播放列表）。 */
  sourceUrl: string;
  /** 播放列表序号（用于稳定排序，可空）。 */
  playlistIndex: number | null;
  /** 时长（秒，可空 → 降级为 —）。 */
  durationSeconds: number | null;
  /** 时长（分钟，四舍五入，可空）。 */
  durationMinutes: number | null;
  /** 发布日期（原始字符串，可空）。 */
  publishedDate: string | null;
  /** 缩略图 URL（可空；本站文本优先，缩略图为可选项）。 */
  thumbnailUrl: string | null;
  /** 主题（近似归类，可空数组，须以「约」标注）。 */
  topics: Topic[];
  /** 状态（默认 indexed；recommended/analyzing 由后续编辑流程回填）。 */
  status: SessionStatus;
  /** 讲者（当前为空数组，待真实标注）。 */
  speakers: Speaker[];
  /** “为什么值得看”编辑解读（当前为 null，缺省降级为官方原片占位）。 */
  whyWatch: string | null;
  /** 关键观点卡（当前为空数组）。 */
  takeaways: Takeaway[];
  /** 角色标注（当前为空数组，不显示编造角标）。 */
  roles: Role[];
  /** 观看导览（清洗流水线产出；缺省 null，页面走详情降级）。 */
  tour: Tour | null;
}

// ---------------------------------------------------------------------------
// 会议级信号聚合（知识层：横切一届大会，回答「这个领域正在发生什么」）
// ---------------------------------------------------------------------------

/** 信号出处：回指某场演讲的具体时刻（沿用观点必须能回指的原则）。 */
export interface DigestSource {
  videoId: string;
  timestampSeconds: number | null;
}

/** 一条跨场信号。 */
export interface DigestSignal {
  title: string;
  statement: string;
  whyItMatters: string;
  sources: DigestSource[];
}

/**
 * 会议信号聚合——不是逐场复述，而是横切归纳。
 * 读者 3 分钟拿到整届大会 payload，再决定深入哪场。缺省为 undefined，页面不渲染该区。
 */
export interface ConferenceDigest {
  conferenceId: ConferenceId;
  talkCount: number;
  headline: string;
  narrative: string;
  signals: DigestSignal[];
}

// ---------------------------------------------------------------------------
// 统计与 dataset 容器
// ---------------------------------------------------------------------------

/** 主题近似计数（标题关键词派生）。 */
export interface TopicCount {
  topic: Topic;
  approxCount: number;
  method: 'title-keyword';
}

/** 站点统计口径（全部派生自真实语料，见 design-spec §4.1/§5.1）。 */
export interface SiteStats {
  /** 已索引 session 数（941）。 */
  totalSessions: number;
  totalDurationSeconds: number;
  /** 总时长小时（四舍五入，409）。 */
  totalHours: number;
  /** 有有效时长的场次数。 */
  withDuration: number;
  /** 深度解读（whyWatch）已产出条数；为 0 时 UI 显示「进行中」。 */
  deepReadCount: number;
  byConference: Record<string, number>;
  topicCounts: TopicCount[];
}

/** 规范化数据集容器（src/data/dataset.json 的顶层形状）。 */
export interface NormalizedDataset {
  datasetVersion: number;
  generatedFrom: string;
  sourceRecordCount: number;
  contract: {
    statuses: readonly SessionStatus[];
    roles: readonly Role[];
    topics: readonly Topic[];
  };
  stats: SiteStats;
  conferences: Conference[];
  sessions: Session[];
  /** 会议信号聚合（按大会一份；无清洗数据的大会缺省）。 */
  digests: ConferenceDigest[];
}

// ---------------------------------------------------------------------------
// 轻量运行时守卫（加载层防御性降级用；权威全量校验在 scripts/build-data.mjs）
// ---------------------------------------------------------------------------

export function isSessionStatus(v: unknown): v is SessionStatus {
  return typeof v === 'string' && (SESSION_STATUSES as readonly string[]).includes(v);
}

export function isTopic(v: unknown): v is Topic {
  return typeof v === 'string' && (TOPICS as readonly string[]).includes(v);
}

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

export function isConferenceId(v: unknown): v is ConferenceId {
  return typeof v === 'string' && (CONFERENCE_IDS as readonly string[]).includes(v);
}

/**
 * 判断一条记录是否满足 Session 的最小必填契约（id / conferenceId / officialUrl / status）。
 * 用于加载层在消费前过滤坏记录，实现“缺失走降级而非报错”。
 */
export function isValidSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    typeof s.title === 'string' &&
    isConferenceId(s.conferenceId) &&
    typeof s.officialUrl === 'string' &&
    s.officialUrl.length > 0 &&
    isSessionStatus(s.status) &&
    Array.isArray(s.topics) &&
    Array.isArray(s.speakers) &&
    Array.isArray(s.takeaways) &&
    Array.isArray(s.roles)
  );
}
