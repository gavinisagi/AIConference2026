import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllSessions } from '@/lib/loader';
import { VideoCard } from '@/components/VideoCard/VideoCard';
import { LandingView } from '@/app/_landing/LandingView';
import { SessionGrid } from '@/app/_landing/SessionGrid';
import {
  BUDGET_PRESETS,
  BUDGET_SLUGS,
  assemblePlaylist,
  type BudgetSlug,
} from '@/app/_landing/presets';
import styles from '@/app/_landing/landing.module.css';

/**
 * /budget/{t} — 时间预算落地页（design-spec §4.5 / §8.2）。
 *
 * 全枚举预生成（10min | 1h | 3h）。不同于筛选式落地页，本页是「歌单式」装配：按预算装配一份
 * 可一次看完的清单，并显示累计时长进度（design-spec §8.2）。装配逻辑见 presets.assemblePlaylist。
 */
export function generateStaticParams(): Array<{ t: BudgetSlug }> {
  return BUDGET_SLUGS.map((t) => ({ t }));
}

function isBudgetSlug(v: string): v is BudgetSlug {
  return (BUDGET_SLUGS as readonly string[]).includes(v);
}

/** 秒 → 人读时长（等宽体，与 loader.displayDuration 同口径）。 */
function humanDuration(totalSeconds: number): string {
  const totalMin = Math.round(totalSeconds / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} h ${String(m).padStart(2, '0')}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ t: string }>;
}): Promise<Metadata> {
  const { t } = await params;
  if (!isBudgetSlug(t)) return { title: '时间预算 · AI Conference 2026 Compass' };
  const preset = BUDGET_PRESETS[t];
  return {
    title: `${preset.label}看什么 · AI Conference 2026 Compass`,
    description: preset.intro,
  };
}

export default async function BudgetLandingPage({
  params,
}: {
  params: Promise<{ t: string }>;
}) {
  const { t } = await params;
  if (!isBudgetSlug(t)) notFound();

  const preset = BUDGET_PRESETS[t];
  const playlist = assemblePlaylist(getAllSessions(), preset.seconds);

  return (
    <LandingView
      crumbs={[
        { label: '目录', href: '/catalog/' },
        { label: '时间预算' },
        { label: preset.label },
      ]}
      kicker="时间预算"
      title={`${preset.label}，看这些`}
      lede={preset.intro}
      metaLine={`装配 ${playlist.items.length} 条 · 累计 ${humanDuration(
        playlist.totalSeconds,
      )} / 预算 ${humanDuration(playlist.budgetSeconds)}`}
    >
      {playlist.items.length === 0 ? (
        <SessionGrid
          sessions={[]}
          emptyTitle="这个时间预算暂时排不出清单"
          emptyHint="需要有效时长的场次才能装配歌单；先去完整目录看看。"
        />
      ) : (
        <>
          <p className={styles.playlistSummary}>
            像歌单一样排好：从上到下依次看完，累计不超过{humanDuration(playlist.budgetSeconds)}。
          </p>
          <ol className={styles.grid}>
            {playlist.items.map((item) => {
              const pct = Math.min(
                100,
                Math.round((item.cumulativeSeconds / playlist.budgetSeconds) * 100),
              );
              return (
                <li key={item.session.id} className={styles.playlistItem}>
                  <VideoCard session={item.session} />
                  <div className={styles.cumRow}>
                    <span>累计 {humanDuration(item.cumulativeSeconds)}</span>
                    <span className={styles.cumBarTrack} aria-hidden="true">
                      <span className={styles.cumBarFill} style={{ width: `${pct}%` }} />
                    </span>
                    <span>{pct}%</span>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </LandingView>
  );
}
