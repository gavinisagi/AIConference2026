/**
 * browseStats.ts — 首页/角色页/会议页头部那几个「硬数字」的统一口径。
 *
 * 和 watchStats 一样的理由：同一个数（多少场相关、共多少分钟必看）会同时出现在
 * 首页入口卡和进去之后的页头上，两处必须由同一个函数算，否则会出现「入口说 30 场、
 * 进去只剩 12 场」这种自相矛盾（上一轮 review 的 P0 就是这类问题）。
 */
import type { ConferenceId, Role, Session } from '@/lib/schema';
import { watchSplit } from '@/lib/watchStats';

export interface PersonaStats {
  /** 该角色相关的场次数。 */
  talks: number;
  /** 这些场次的必看分钟数合计。 */
  mustWatchMinutes: number;
  /** 覆盖几场大会。 */
  conferences: number;
}

export function personaStats(sessions: readonly Session[], role: Role): PersonaStats {
  const hits = sessions.filter((s) => s.roles.includes(role));
  return {
    talks: hits.length,
    mustWatchMinutes: hits.reduce((sum, s) => sum + watchSplit(s.tour).watchMinutes, 0),
    conferences: new Set(hits.map((s) => s.conferenceId)).size,
  };
}

export interface ConferenceStats {
  talks: number;
  /** 「推荐必看」场次：必看时长 >= 10 分钟，说明有实打实的演示/图表值得看。 */
  mustWatchTalks: number;
  /** 总时长（小时，一位小数）。 */
  hours: number;
}

export function conferenceStats(
  sessions: readonly Session[],
  conferenceId: ConferenceId,
): ConferenceStats {
  const own = sessions.filter((s) => s.conferenceId === conferenceId);
  const totalSeconds = own.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  return {
    talks: own.length,
    mustWatchTalks: own.filter((s) => watchSplit(s.tour).watchMinutes >= 10).length,
    hours: Math.round((totalSeconds / 3600) * 10) / 10,
  };
}

/**
 * 会议封面：用该会议里留存关键帧最多的那场的首帧。
 *
 * 设计稿这里是「拖入主视觉」的图片占位——我们没有会议官方主视觉，也不该去外部
 * 抓图。用站内真实留存的关键画面代替：既是这场大会的真实内容，也不必新增素材。
 * 选帧最多的那场是因为帧多通常意味着这场演示/图表密集，首帧更可能是有内容的画面。
 */
export function conferenceCover(
  sessions: readonly Session[],
  conferenceId: ConferenceId,
): { src: string; alt: string } | null {
  const own = sessions
    .filter((s) => s.conferenceId === conferenceId && s.frames.length > 0)
    .sort((a, b) => b.frames.length - a.frames.length);
  const best = own[0];
  if (!best) return null;
  const frame = best.frames[0];
  return { src: frame.src, alt: frame.caption || best.tour?.hook || best.title };
}
