import type { Metadata } from 'next';
import { getConferenceById, getSessionsByConference, displayTitle, displayDuration } from '@/lib/loader';
import type { Session } from '@/lib/schema';
import { VideoCard } from '@/app/catalog/VideoCard';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import styles from './compile.module.css';

/**
 * /compile — Cursor Compile 导览站 hub。
 * 承接层入口：把已产出观看导览的场次作为主推，其余场次列表兜底。
 */
export const metadata: Metadata = {
  title: 'Cursor Compile 导览 · AI Conference 2026 Compass',
  description: '一场 Cursor Compile 演讲，替你扒好观看导览：谁该看、时间不够看哪段、逐段看/略/听。',
};

export default function CompileHubPage() {
  const conf = getConferenceById('cursor-compile');
  const all = [...getSessionsByConference('cursor-compile')].sort(
    (a, b) => (a.playlistIndex ?? 999) - (b.playlistIndex ?? 999),
  );
  const withTour = all.filter((s) => s.tour);
  const rest = all.filter((s) => !s.tour);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb items={[{ label: '目录', href: '/catalog/' }, { label: 'Cursor Compile' }]} />

        <header className={styles.hero}>
          <span className={styles.eyebrow}>会议导览</span>
          <h1 className={styles.h1}>{conf?.name ?? 'Cursor Compile'}</h1>
          <p className={styles.lead}>
            {all.length} 场演讲。我们把每一场扒成观看导览——一句话钩子、谁该看、时间不够看哪段、
            逐段告诉你该 <b>看画面</b> 还是 <b>略读</b> 或 <b>听就够</b>，配官方原片时间戳深链。
          </p>
        </header>

        {withTour.length > 0 && (
          <section className={styles.section} aria-labelledby="featured">
            <h2 id="featured" className={styles.sectionHead}>导览已就绪</h2>
            <ul className={styles.featList}>
              {withTour.map((s) => (
                <li key={s.id}>
                  <FeaturedTour session={s} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {rest.length > 0 && (
          <section className={styles.section} aria-labelledby="all">
            <h2 id="all" className={styles.sectionHead}>
              全部场次{withTour.length > 0 ? ' · 导览整理中' : ''}
            </h2>
            <ul className={styles.grid}>
              {rest.map((s) => (
                <li key={s.id}>
                  <VideoCard session={s} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

/** 导览已就绪的场次卡：突出钩子 + 必看点 + 看/略/听占比，整卡进详情页。 */
function FeaturedTour({ session }: { session: Session }) {
  const tour = session.tour!;
  const agg = { watch: 0, skim: 0, listen: 0 };
  for (const st of tour.stops) agg[st.howTo] += Math.max(0, st.endSeconds - st.startSeconds);
  const total = agg.watch + agg.skim + agg.listen || 1;
  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <a className={styles.featCard} href={`/video/${session.id}/`}>
      <div className={styles.featTop}>
        <span className={styles.featBadge}>观看导览</span>
        <span className={styles.featMeta}>{displayDuration(session)}</span>
      </div>
      <h3 className={styles.featTitle}>{displayTitle(session)}</h3>
      <p className={styles.featHook}>{tour.hook}</p>
      <div className={styles.featStats}>
        <span className={styles.miniBar} aria-hidden="true">
          <i style={{ width: `${pct(agg.watch)}%` }} className={styles.bw} />
          <i style={{ width: `${pct(agg.skim)}%` }} className={styles.bs} />
          <i style={{ width: `${pct(agg.listen)}%` }} className={styles.bl} />
        </span>
        <span className={styles.featStatText}>
          看 {pct(agg.watch)}% · 略 {pct(agg.skim)}% · 听 {pct(agg.listen)}%
          {tour.mustWatch.length > 0 && ` · ${tour.mustWatch.length} 个必看点`}
        </span>
      </div>
    </a>
  );
}
