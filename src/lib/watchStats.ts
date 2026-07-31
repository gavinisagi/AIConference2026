/**
 * watchStats.ts — 由导览派生「该花多少眼力」的口径。
 *
 * 全部从既有字段算出，不需要额外 LLM 产出：页面上的「必看 X min」
 * 「可当播客听」「20 分钟内看完」都归到这里，避免各页面各写一套算法后口径不一致。
 *
 * 「必看」秒数不能只看 stops[].howTo==='watch'——tour 阶段的 LLM 常把「值得看
 * 画面」的判断落在 mustWatch（明确给出时间区间+理由）而不是逐段 howTo 上，
 * 二者并不总是重合。只看 stops 会出现"必看播放列表 11 min"却"真正值得盯屏
 * 0 分钟"这种同页矛盾。故取 stops(watch) 与 mustWatch 区间的并集、合并重叠
 * 区间后求和，作为唯一权威口径。
 */
import type { Tour, TourMustWatch, TourStop } from '@/lib/schema';

/** 看/略/听各自的秒数，以及派生的盯屏分钟数。 */
export interface WatchSplit {
  watchSeconds: number;
  skimSeconds: number;
  listenSeconds: number;
  totalSeconds: number;
  /** 需要盯屏的分钟数（watch 区间合计，四舍五入到分钟）。 */
  watchMinutes: number;
  watchPct: number;
  skimPct: number;
  listenPct: number;
}

const EMPTY: WatchSplit = {
  watchSeconds: 0, skimSeconds: 0, listenSeconds: 0, totalSeconds: 0,
  watchMinutes: 0, watchPct: 0, skimPct: 0, listenPct: 0,
};

interface Interval {
  start: number;
  end: number;
}

/** 合并重叠/相邻区间，返回互不重叠的区间列表（按起点排序）。 */
function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

function sumSeconds(intervals: readonly Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.end - i.start), 0);
}

/**
 * 按 stops(howTo='watch') ∪ mustWatch 区间聚合「必看」时长；无导览 → 全 0（页面据此降级）。
 * 接受 Tour 而非 Session——TourView 手上只有 tour，两处调用方共用同一份口径。
 */
export function watchSplit(tour: Tour | null | undefined): WatchSplit {
  const stops = tour?.stops ?? [];
  if (stops.length === 0) return EMPTY;

  const totalSeconds = stops.reduce((sum, s) => sum + Math.max(0, s.endSeconds - s.startSeconds), 0);
  if (totalSeconds === 0) return EMPTY;

  const watchIntervals = mergeIntervals([
    ...stops
      .filter((s: TourStop) => s.howTo === 'watch')
      .map((s) => ({ start: s.startSeconds, end: s.endSeconds })),
    ...(tour?.mustWatch ?? []).map((m: TourMustWatch) => ({
      start: m.startSeconds,
      end: m.endSeconds,
    })),
  ]);
  const watchSeconds = Math.min(totalSeconds, sumSeconds(watchIntervals));

  // skim/listen 仍按逐段 howTo 分——它们不参与「必看」判定，没有并集问题。
  let skimSeconds = 0;
  let listenSeconds = 0;
  for (const st of stops) {
    if (st.howTo === 'skim') skimSeconds += Math.max(0, st.endSeconds - st.startSeconds);
    else if (st.howTo === 'listen') listenSeconds += Math.max(0, st.endSeconds - st.startSeconds);
  }

  const pct = (n: number) => Math.round((n / totalSeconds) * 100);
  return {
    watchSeconds,
    skimSeconds,
    listenSeconds,
    totalSeconds,
    watchMinutes: Math.round(watchSeconds / 60),
    watchPct: pct(watchSeconds),
    skimPct: pct(skimSeconds),
    listenPct: pct(listenSeconds),
  };
}

/** 观看形态：据必看占比归成三类，供列表页标注与「场景」筛选复用。 */
export type WatchShape = 'commute' | 'mixed' | 'screen';

export function watchShape(split: WatchSplit): WatchShape {
  if (split.totalSeconds === 0) return 'mixed';
  if (split.watchPct <= 10) return 'commute';
  if (split.watchPct >= 40) return 'screen';
  return 'mixed';
}

/** 首页「场景」筛选口径。 */
export type Scene = 'commute' | 'quick' | 'deep';

export function matchesScene(split: WatchSplit, scene: Scene): boolean {
  switch (scene) {
    // 通勤听：几乎不需要盯屏。
    case 'commute':
      return watchShape(split) === 'commute';
    // 20 分钟内看完：以「读导览 + 只看必看片段」的实际花费计，不是全片时长。
    case 'quick':
      return split.watchMinutes > 0 && split.watchMinutes <= 20;
    // 值得认真看：盯屏时间可观，说明有大量演示/图表内容。
    case 'deep':
      return split.watchMinutes >= 12;
  }
}
