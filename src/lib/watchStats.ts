/**
 * watchStats.ts — 由导览派生「该花多少眼力」的口径。
 *
 * 全部从既有字段算出（tour.stops 的 howTo + 时间区间），不需要额外 LLM 产出：
 * 页面上的「必看 X min」「可当播客听」「20 分钟内看完」都归到这里，
 * 避免各页面各写一套算法后口径不一致。
 */
import type { Session, TourMode } from '@/lib/schema';

/** 看/略/听各自的秒数，以及派生的盯屏分钟数。 */
export interface WatchSplit {
  watchSeconds: number;
  skimSeconds: number;
  listenSeconds: number;
  totalSeconds: number;
  /** 需要盯屏的分钟数（watch 档合计，向上取整到分钟）。 */
  watchMinutes: number;
  watchPct: number;
  skimPct: number;
  listenPct: number;
}

const EMPTY: WatchSplit = {
  watchSeconds: 0, skimSeconds: 0, listenSeconds: 0, totalSeconds: 0,
  watchMinutes: 0, watchPct: 0, skimPct: 0, listenPct: 0,
};

/** 按 stops 的 howTo 聚合三档时长。无导览 → 全 0（页面据此降级，不编造）。 */
export function watchSplit(session: Session): WatchSplit {
  const stops = session.tour?.stops ?? [];
  if (stops.length === 0) return EMPTY;

  const acc: Record<TourMode, number> = { watch: 0, skim: 0, listen: 0 };
  for (const st of stops) {
    acc[st.howTo] += Math.max(0, st.endSeconds - st.startSeconds);
  }
  const totalSeconds = acc.watch + acc.skim + acc.listen;
  if (totalSeconds === 0) return EMPTY;

  const pct = (n: number) => Math.round((n / totalSeconds) * 100);
  return {
    watchSeconds: acc.watch,
    skimSeconds: acc.skim,
    listenSeconds: acc.listen,
    totalSeconds,
    watchMinutes: Math.round(acc.watch / 60),
    watchPct: pct(acc.watch),
    skimPct: pct(acc.skim),
    listenPct: pct(acc.listen),
  };
}

/** 观看形态：据盯屏占比归成三类，供列表页标注与「场景」筛选复用。 */
export type WatchShape = 'commute' | 'mixed' | 'screen';

export function watchShape(split: WatchSplit): WatchShape {
  if (split.totalSeconds === 0) return 'mixed';
  if (split.watchPct <= 20) return 'commute';
  if (split.watchPct >= 50) return 'screen';
  return 'mixed';
}

/** 首页「场景」筛选口径。 */
export type Scene = 'commute' | 'quick' | 'deep';

export function matchesScene(session: Session, split: WatchSplit, scene: Scene): boolean {
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
