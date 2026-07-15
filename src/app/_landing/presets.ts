/**
 * presets.ts — 落地页预设逻辑层（design-spec §4.5 落地页 / §6.2）。
 *
 * 落地页本质是「目录的预设筛选视图 + 一段编辑导语」（design-spec §3.7）。本文件集中声明
 * 三类落地页（角色 / 时间预算 / 主题）的枚举、编辑导语与「预设筛选」逻辑，页面只做渲染。
 *
 * 复用 T4 目录页的纯筛选逻辑（catalog/filters.ts 的 applyFilters），不重复实现筛选；
 * 时间预算页额外提供「歌单式」装配器（按预算装配可看完的条目 + 累计时长进度）。
 *
 * 诚实原则（design-spec §7.1）：角色↔视频映射当前无真实标注（roles 全为空），故角色落地页
 * 预设筛选真实产出 0 条，走空态导语而非编造清单；主题为标题关键词近似归类，须以「约」表述。
 */
import { EMPTY_FILTERS, applyFilters } from '@/app/catalog/filters';
import type { Session, Role, Topic } from '@/lib/schema';
import { TOPICS } from '@/lib/schema';
import { topicMeta } from '@/design/tokens';

// ---------------------------------------------------------------------------
// 角色落地 /for/{role}
// ---------------------------------------------------------------------------

export interface RolePreset {
  role: Role;
  /** 展示名。 */
  name: string;
  /** 编辑导语（一段，落地页顶部）。 */
  intro: string;
}

export const ROLE_PRESETS: Record<Role, RolePreset> = {
  developer: {
    role: 'developer',
    name: '开发者',
    intro:
      '把 Agent、评测与上下文工程真正落到代码里的实战场次——工具链、架构取舍与踩坑复盘，面向要动手的人。',
  },
  'product-design': {
    role: 'product-design',
    name: '产品 / 设计',
    intro:
      'AI 时代的产品与设计怎么做：从需求形态到 Design-to-Code 的前沿实践，帮你把「AI 能力」翻译成「产品价值」。',
  },
  'founder-lead': {
    role: 'founder-lead',
    name: '创始人 / 负责人',
    intro:
      '战略判断、团队搭建与落地节奏——来自一线创始人与负责人的经验，帮你在不确定里少踩坑、押对方向。',
  },
  trend: {
    role: 'trend',
    name: '只想跟进趋势',
    intro: '不写代码，也想看懂这一年 AI 走到了哪：脉络、拐点与共识，用最省力的方式跟上。',
  },
};

/** /for/{role} 的预设筛选结果（当前角色标注为空 → 返回空数组，页面走空态）。 */
export function sessionsForRole(sessions: readonly Session[], role: Role): Session[] {
  return applyFilters(sessions, { ...EMPTY_FILTERS, role: [role] });
}

// ---------------------------------------------------------------------------
// 主题落地 /topic/{slug}
// ---------------------------------------------------------------------------

export interface TopicPreset {
  topic: Topic;
  /** 展示名（英文专有名词保留原文，§1.4）。 */
  name: string;
  /** 编辑导语。 */
  intro: string;
}

const TOPIC_INTROS: Record<Topic, string> = {
  agent: '自主智能体的构建、编排与落地——从单体 Agent 到多智能体协作，最热也最卷的一条主线。',
  'ai-coding': 'AI 辅助与自动化写代码：从补全到端到端生成，工程实践正在被重写。',
  evals: '如何科学评测模型与产品质量——没有可靠的 Evals，就没有可靠的迭代。',
  context: '上下文工程、检索与记忆：让模型「知道该知道的」，是能力落地的关键一环。',
  'design-to-code': '从设计稿到可用代码的自动化——设计与前端的边界正在消融。',
  'ai-product': 'AI 原生产品的形态、体验与增长：新范式下，什么才是好产品。',
};

export const TOPIC_PRESETS: Record<Topic, TopicPreset> = TOPICS.reduce(
  (acc, t) => {
    acc[t] = { topic: t, name: topicMeta[t].label, intro: TOPIC_INTROS[t] };
    return acc;
  },
  {} as Record<Topic, TopicPreset>,
);

/** /topic/{slug} 的预设筛选结果（主题为近似归类，命中真实语料）。 */
export function sessionsForTopic(sessions: readonly Session[], topic: Topic): Session[] {
  return applyFilters(sessions, { ...EMPTY_FILTERS, topic: [topic] });
}

// ---------------------------------------------------------------------------
// 时间预算落地 /budget/{t}
// ---------------------------------------------------------------------------

/** 支持的时间预算枚举（design-spec §4.1 区块 4 / §4.5）。 */
export const BUDGET_SLUGS = ['10min', '1h', '3h'] as const;
export type BudgetSlug = (typeof BUDGET_SLUGS)[number];

export interface BudgetPreset {
  slug: BudgetSlug;
  /** 展示名。 */
  label: string;
  /** 预算秒数。 */
  seconds: number;
  /** 编辑导语。 */
  intro: string;
}

export const BUDGET_PRESETS: Record<BudgetSlug, BudgetPreset> = {
  '10min': {
    slug: '10min',
    label: '10 分钟',
    seconds: 10 * 60,
    intro: '一杯咖啡的时间，先看最精华的几条——像歌单一样帮你排好，看完正好。',
  },
  '1h': {
    slug: '1h',
    label: '1 小时',
    seconds: 60 * 60,
    intro: '通勤或午休的一小时，系统补齐一个方向。按累计时长排好，不用自己算。',
  },
  '3h': {
    slug: '3h',
    label: '3 小时',
    seconds: 3 * 60 * 60,
    intro: '一个周末下午，深度过一遍重点。装配成一份可一次看完的清单。',
  },
};

/** 歌单中的一项：session + 看到此条为止的累计秒数（用于进度展示）。 */
export interface PlaylistItem {
  session: Session;
  /** 含本条在内的累计时长（秒）。 */
  cumulativeSeconds: number;
}

export interface Playlist {
  items: PlaylistItem[];
  /** 装配后的总时长（秒）。 */
  totalSeconds: number;
  /** 预算秒数。 */
  budgetSeconds: number;
}

/** 歌单最多条目数——避免长预算下清单过长，保持「一次看完」的编辑感。 */
const MAX_PLAYLIST_ITEMS = 12;

/**
 * 按时间预算装配「歌单式」清单（design-spec §4.1 区块 4 / §8.2）。
 *
 * 贪心：按目录默认序（推荐优先 + 稳定序，复用 applyFilters 的排序）遍历，凡「本条时长 <= 剩余预算」
 * 即纳入并累加，直至预算不足以再放下任何一条或达到条目上限。只收有有效时长的场次
 * （无时长记录无法计入预算，design-spec §7.1 不编造归类）。
 */
export function assemblePlaylist(sessions: readonly Session[], budgetSeconds: number): Playlist {
  const ordered = applyFilters(sessions, { ...EMPTY_FILTERS });
  const items: PlaylistItem[] = [];
  let total = 0;
  for (const session of ordered) {
    if (items.length >= MAX_PLAYLIST_ITEMS) break;
    const sec = session.durationSeconds;
    if (sec === null || sec <= 0) continue; // 无时长无法计入预算
    if (total + sec > budgetSeconds) continue; // 放不下则跳过，尝试更短的后续条目
    total += sec;
    items.push({ session, cumulativeSeconds: total });
  }
  return { items, totalSeconds: total, budgetSeconds };
}
