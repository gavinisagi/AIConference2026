import {
  getConferenceById,
  getSessionsByConference,
  getSessionById,
  getDigestByConference,
  displayTitle,
  displayDuration,
} from '@/lib/loader';
import type { ConferenceDigest, Session } from '@/lib/schema';
import { frameSrc } from '@/lib/assets';
import { VideoCard } from '@/components/VideoCard/VideoCard';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import styles from './compile.module.css';

/**
 * CompileHub — 会议导览 hub（知识层信号 + 逐场导览）。
 * 上线范围收敛到 Cursor Compile，故首页与 /compile 共用本组件；
 * asHome 时用站点级框架（站名 + 免责声明），否则用会议级面包屑。
 */
export function CompileHub({ asHome = false }: { asHome?: boolean }) {
  const conf = getConferenceById('cursor-compile');
  const all = [...getSessionsByConference('cursor-compile')].sort(
    (a, b) => (a.playlistIndex ?? 999) - (b.playlistIndex ?? 999),
  );
  const withTour = all.filter((s) => s.tour);
  const rest = all.filter((s) => !s.tour);
  const digest = getDigestByConference('cursor-compile');

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        {!asHome && (
          <Breadcrumb items={[{ label: '导览', href: '/' }, { label: 'Cursor Compile' }]} />
        )}

        <header className={styles.hero}>
          <span className={styles.eyebrow}>{asHome ? 'AI 大会导览' : '会议导览'}</span>
          <h1 className={styles.h1}>{conf?.name ?? 'Cursor Compile'}</h1>
          <p className={styles.lead}>
            {all.length} 场演讲。我们把每一场扒成观看导览——一句话钩子、谁该看、时间不够看哪段、
            逐段告诉你该 <b>看画面</b> 还是 <b>略读</b> 或 <b>听就够</b>，配官方原片时间戳深链。
          </p>
        </header>

        {/* 知识层：横切全会议的信号。读者 3 分钟拿到整届 payload，再决定深入哪场。 */}
        {digest && <DigestPanel digest={digest} />}

        {withTour.length > 0 && (
          <section className={styles.section} aria-labelledby="featured">
            <h2 id="featured" className={styles.sectionHead}>
              逐场导览 · {withTour.length} 场
            </h2>
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

/** 官方源深链：跳到该场演讲的具体时刻。 */
function officialAt(url: string, seconds: number | null): string {
  if (seconds === null || seconds <= 0) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Math.floor(seconds)}s`;
}

/** 出处标签：短标题（去掉「, 讲者 | Compile 26」尾巴；过长按词边界截断加省略号）。 */
function shortTitle(title: string): string {
  const head = title.split(/[,|｜]/)[0].trim();
  if (head.length <= 26) return head;
  const cut = head.slice(0, 26);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 12 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * 信号面板（知识层）——横切全会议归纳「这个领域正在发生什么」。
 * 每条信号带出处深链，沿用「观点必须能回指来源」的原则。
 */
function DigestPanel({ digest }: { digest: ConferenceDigest }) {
  return (
    <section className={styles.digest} aria-labelledby="signals">
      <h2 id="signals" className={styles.sectionHead}>
        这届大会发生了什么 · {digest.signals.length} 个信号
      </h2>
      <p className={styles.digestHeadline}>{digest.headline}</p>
      {digest.narrative && <p className={styles.digestNarrative}>{digest.narrative}</p>}

      <ol className={styles.signalList}>
        {digest.signals.map((sig, i) => (
          <li key={i} className={styles.signal}>
            <span className={styles.signalNo}>{String(i + 1).padStart(2, '0')}</span>
            <div className={styles.signalBody}>
              <h3 className={styles.signalTitle}>{sig.title}</h3>
              <p className={styles.signalStatement}>{sig.statement}</p>
              {sig.whyItMatters && (
                <p className={styles.signalWhy}>
                  <span className={styles.signalWhyLabel}>为何重要</span>
                  {sig.whyItMatters}
                </p>
              )}
              {sig.sources.length > 0 && (
                <div className={styles.sources}>
                  <span className={styles.sourcesLabel}>出处</span>
                  {sig.sources.map((src, j) => {
                    const s = getSessionById(src.videoId);
                    if (!s) return null;
                    const m = src.timestampSeconds !== null ? Math.floor(src.timestampSeconds / 60) : null;
                    const sec = src.timestampSeconds !== null ? Math.floor(src.timestampSeconds % 60) : null;
                    return (
                      <a
                        key={j}
                        className={styles.sourceLink}
                        href={officialAt(s.officialUrl, src.timestampSeconds)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {shortTitle(displayTitle(s))}
                        {m !== null && sec !== null && (
                          <span className={styles.sourceTime}>
                            {' '}
                            {m}:{String(sec).padStart(2, '0')}
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 导览已就绪的场次卡：突出钩子 + 必看点 + 看/略/听占比，整卡进详情页。 */
function FeaturedTour({ session }: { session: Session }) {
  const tour = session.tour!;
  const agg = { watch: 0, skim: 0, listen: 0 };
  for (const st of tour.stops) agg[st.howTo] += Math.max(0, st.endSeconds - st.startSeconds);
  const total = agg.watch + agg.skim + agg.listen || 1;
  const pct = (n: number) => Math.round((n / total) * 100);

  const cover = session.frames[0];

  return (
    <a className={styles.featCard} href={`/video/${session.id}/`}>
      {/* 封面用该场留存的首张关键画面；无画面则不占位（不放占位图）。 */}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.featCover}
          src={frameSrc(cover.src)}
          alt={cover.caption || displayTitle(session)}
          loading="lazy"
          width={640}
          height={360}
        />
      )}
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
