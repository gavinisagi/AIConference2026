import {
  getConferenceById,
  getSessionsByConference,
  getSessionById,
  getDigestByConference,
  displayTitle,
  displayDuration,
} from '@/lib/loader';
import type { ConferenceDigest, ConferenceId, Session } from '@/lib/schema';
import { frameSrc } from '@/lib/assets';
import type { Locale } from '@/i18n/locale';
import { getDictionary, type Dictionary } from '@/i18n/getDictionary';
import { renderRich } from '@/i18n/rich';
import { VideoCard } from '@/components/VideoCard/VideoCard';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import styles from './ConferenceHub.module.css';

/**
 * ConferenceHub — 会议导览 hub（知识层信号 + 逐场导览）。
 *
 * 按 conferenceId 参数化，供 /c/[conferenceId] 与 /en/c/[conferenceId] 复用；
 * 新开一场会议无需新写组件，只要该会议有已发布场次，路由会自动生成（见
 * app/c/[conferenceId]/page.tsx 的 generateStaticParams）。locale 显式传入
 * （非 [locale] 动态段方案，见 src/i18n/locale.ts），驱动 UI 框架文案；
 * 演讲的钩子/观点/信号等 LLM 生成的中文正文不受 locale 影响，两种语言下同源。
 */
export function ConferenceHub({ conferenceId, locale }: { conferenceId: ConferenceId; locale: Locale }) {
  const dict = getDictionary(locale);
  const conf = getConferenceById(conferenceId);
  const all = [...getSessionsByConference(conferenceId)].sort(
    (a, b) => (a.playlistIndex ?? 999) - (b.playlistIndex ?? 999),
  );
  const withTour = all.filter((s) => s.tour);
  const rest = all.filter((s) => !s.tour);
  const digest = getDigestByConference(conferenceId);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb
          ariaLabel={dict.breadcrumb.ariaLabel}
          items={[{ label: dict.breadcrumb.home, href: locale === 'en' ? '/en/' : '/' }, { label: conf?.name ?? conferenceId }]}
        />

        <header className={styles.hero}>
          <span className={styles.eyebrow}>{dict.hub.eyebrow}</span>
          <h1 className={styles.h1}>{conf?.name ?? conferenceId}</h1>
          <p className={styles.lead}>{renderRich(dict.hub.lead(all.length))}</p>
        </header>

        {/* 知识层导语：一屏内交代「这届发生了什么」，把详细信号让到导览之后。
            实测原先信号完整铺开时首场演讲要滑好几屏才出现，首页读起来像长报告而非导览工具。 */}
        {digest && <DigestIntro digest={digest} dict={dict} />}

        {withTour.length > 0 && (
          <section className={styles.section} aria-labelledby="featured">
            <h2 id="featured" className={styles.sectionHead}>
              {dict.hub.featuredHeading(withTour.length)}
            </h2>
            <ul className={styles.featList}>
              {withTour.map((s) => (
                <li key={s.id}>
                  <FeaturedTour session={s} dict={dict} locale={locale} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {rest.length > 0 && (
          <section className={styles.section} aria-labelledby="all">
            <h2 id="all" className={styles.sectionHead}>
              {withTour.length > 0 ? dict.hub.allSessionsHeadingWithProgress : dict.hub.allSessionsHeading}
            </h2>
            <ul className={styles.grid}>
              {rest.map((s) => (
                <li key={s.id}>
                  <VideoCard session={s} locale={locale} />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 详细信号：想读趋势的人往下看，不挡在导览前面。 */}
        {digest && <DigestSignals digest={digest} dict={dict} />}
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

/** 出处标签：短标题（去掉「, 讲者 | 大会名」尾巴；过长按词边界截断加省略号）。 */
function shortTitle(title: string): string {
  const head = title.split(/[,|｜]/)[0].trim();
  if (head.length <= 26) return head;
  const cut = head.slice(0, 26);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 12 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * 信号面板导语（知识层）——横切全会议归纳「这个领域正在发生什么」。
 * 每条信号带出处深链，沿用「观点必须能回指来源」的原则。
 */
function DigestIntro({ digest, dict }: { digest: ConferenceDigest; dict: Dictionary }) {
  return (
    <section className={styles.digestIntro} aria-labelledby="digest-intro">
      <h2 id="digest-intro" className={styles.sectionHead}>
        {dict.hub.digestIntroHeading}
      </h2>
      <p className={styles.digestHeadline}>{digest.headline}</p>
      {digest.narrative && <p className={styles.digestNarrative}>{digest.narrative}</p>}
      <a className={styles.digestJump} href="#signals">
        {dict.hub.expandSignals(digest.signals.length)}
      </a>
    </section>
  );
}

/** 详细信号列表：置于导览之后，供想读趋势的读者深入。 */
function DigestSignals({ digest, dict }: { digest: ConferenceDigest; dict: Dictionary }) {
  return (
    <section className={styles.digest} aria-labelledby="signals">
      <h2 id="signals" className={styles.sectionHead}>
        {dict.hub.digestSignalsHeading(digest.signals.length)}
      </h2>

      <ol className={styles.signalList}>
        {digest.signals.map((sig, i) => (
          <li key={i} className={styles.signal}>
            <span className={styles.signalNo}>{String(i + 1).padStart(2, '0')}</span>
            <div className={styles.signalBody}>
              <h3 className={styles.signalTitle}>{sig.title}</h3>
              <p className={styles.signalStatement}>{sig.statement}</p>
              {sig.whyItMatters && (
                <p className={styles.signalWhy}>
                  <span className={styles.signalWhyLabel}>{dict.hub.whyItMatters}</span>
                  {sig.whyItMatters}
                </p>
              )}
              {sig.sources.length > 0 && (
                <div className={styles.sources}>
                  <span className={styles.sourcesLabel}>{dict.hub.sources}</span>
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
                        {shortTitle(displayTitle(s, dict))}
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
function FeaturedTour({ session, dict, locale }: { session: Session; dict: Dictionary; locale: Locale }) {
  const tour = session.tour!;
  const agg = { watch: 0, skim: 0, listen: 0 };
  for (const st of tour.stops) agg[st.howTo] += Math.max(0, st.endSeconds - st.startSeconds);
  const total = agg.watch + agg.skim + agg.listen || 1;
  const pct = (n: number) => Math.round((n / total) * 100);

  const cover = session.frames[0];
  const videoHref = locale === 'en' ? `/en/video/${session.id}/` : `/video/${session.id}/`;

  return (
    <a className={styles.featCard} href={videoHref}>
      {/* 封面用该场留存的首张关键画面；无画面则不占位（不放占位图）。 */}
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.featCover}
          src={frameSrc(cover.src)}
          alt={cover.caption || displayTitle(session, dict)}
          loading="lazy"
          width={640}
          height={360}
        />
      )}
      <div className={styles.featTop}>
        <span className={styles.featBadge}>{dict.hub.tourBadge}</span>
        <span className={styles.featMeta}>{displayDuration(session)}</span>
      </div>
      <h3 className={styles.featTitle}>{displayTitle(session, dict)}</h3>
      <p className={styles.featHook}>{tour.hook}</p>
      <div className={styles.featStats}>
        <span className={styles.miniBar} aria-hidden="true">
          <i style={{ width: `${pct(agg.watch)}%` }} className={styles.bw} />
          <i style={{ width: `${pct(agg.skim)}%` }} className={styles.bs} />
          <i style={{ width: `${pct(agg.listen)}%` }} className={styles.bl} />
        </span>
        <span className={styles.featStatText}>
          {dict.hub.proportion(pct(agg.watch), pct(agg.skim), pct(agg.listen), tour.mustWatch.length)}
        </span>
      </div>
    </a>
  );
}
