import type { SessionFrame, Tour, TourMode } from '@/lib/schema';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import { renderRich } from '@/i18n/rich';
import { frameSrc } from '@/lib/assets';
import styles from './TourView.module.css';

/**
 * TourView — 观看导览（承接层核心体验）。
 * 静态渲染：钩子 / 谁该看 + 时间占比 / 时间不够看哪段 / 必看片段 / 逐段 watch·skim·listen。
 * 所有深链外跳官方源带时间戳（本站不播放）。locale 驱动 UI 框架文案；tour 本身
 * （hook/whyWatch/stops 等）是流水线生成的中文正文，不受 locale 影响。
 */

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function at(url: string, seconds: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}t=${Math.floor(seconds)}s`;
}

/**
 * 说话人是否可展示：diarization 原始标签（S01/S02…）对读者是噪声，
 * 推断不出真名时宁可不显示，也不暴露内部编号。
 */
function displayableSpeaker(speaker: string): string | null {
  const s = speaker.trim();
  if (!s || /^S\d+$/i.test(s)) return null;
  return s;
}

function minutesOf(sec: number): number {
  return Math.round(sec / 60);
}

export function TourView({
  tour,
  officialUrl,
  frames = [],
  locale,
}: {
  tour: Tour;
  officialUrl: string;
  /** 留存的关键画面；为空则不渲染画面区（不占位、不放占位图）。 */
  frames?: SessionFrame[];
  locale: Locale;
}) {
  const dict = getDictionary(locale);
  const modeLabel = dict.tour.modeLabel;
  const modeHint = dict.tour.modeHint;

  const agg: Record<TourMode, number> = { watch: 0, skim: 0, listen: 0 };
  for (const st of tour.stops) agg[st.howTo] += Math.max(0, st.endSeconds - st.startSeconds);
  const total = agg.watch + agg.skim + agg.listen || 1;
  const durationSec = tour.stops.reduce((mx, s) => Math.max(mx, s.endSeconds), 0);

  return (
    <div className={styles.tour}>
      {/* 钩子 hero：进来第一眼就是它。 */}
      <p className={styles.hookHero}>{tour.hook}</p>

      {/* 一行硬统计：全片多长 · 真正值得盯屏多久 · 几个必看点。 */}
      <p className={styles.statline}>
        {renderRich(dict.tour.statFullLength(minutesOf(durationSec)))}
        <span className={styles.statDot}>·</span>
        {renderRich(dict.tour.statWatchLength(minutesOf(agg.watch)), styles.statWatch)}
        {tour.mustWatch.length > 0 && (
          <>
            <span className={styles.statDot}>·</span>
            {renderRich(dict.tour.statMustWatch(tour.mustWatch.length))}
          </>
        )}
      </p>

      {/* 必看片段：转化力最强，前置。 */}
      {tour.mustWatch.length > 0 && (
        <section className={styles.section} id="must">
          <h3 className={styles.sectionHead}>{dict.tour.mustWatchHeading}</h3>
          <div className={styles.mustList}>
            {tour.mustWatch.map((m, i) => (
              <a
                key={i}
                href={at(officialUrl, m.startSeconds)}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.mustCard}
              >
                <div className={styles.mustTop}>
                  <span className={styles.tc}>{mmss(m.startSeconds)}–{mmss(m.endSeconds)}</span>
                  {m.live && <span className={styles.live}>{dict.tour.liveBadge}</span>}
                  <b>{m.label}</b>
                </div>
                {m.why && <p className={styles.mustWhy}>{m.why}</p>}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* 关键画面：流水线留存的可读屏幕内容（幻灯片/图表/代码/界面），点击跳原片对应时刻。 */}
      {frames.length > 0 && (
        <section className={styles.section} id="frames">
          <h3 className={styles.sectionHead}>{dict.tour.framesHeading}</h3>
          <ul className={styles.frameStrip}>
            {frames.map((f) => (
              <li key={f.src} className={styles.frameItem}>
                <a
                  href={at(officialUrl, f.timestampSeconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.frameLink}
                >
                  {/* 静态导出：用原生 img 避免 next/image 的运行时优化依赖。 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={styles.frameImg}
                    src={frameSrc(f.src)}
                    alt={f.caption || dict.tour.frameAlt(mmss(f.timestampSeconds))}
                    loading="lazy"
                    width={480}
                    height={270}
                  />
                  <span className={styles.frameMeta}>
                    <span className={styles.frameTime}>{mmss(f.timestampSeconds)}</span>
                    {f.caption && <span className={styles.frameCaption}>{f.caption}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 决策带：谁该看 + 时间占比 + 时间不够。 */}
      <div className={styles.band} id="time">
        {tour.whoShouldWatch && (
          <div className={styles.who}>
            <span className={styles.bandLabel}>{dict.tour.whoShouldWatch}</span>
            <span>{tour.whoShouldWatch}</span>
          </div>
        )}

        <div>
          <span className={styles.bandLabel}>{dict.tour.timeAllocation}</span>
          <div className={styles.propbar} role="img" aria-label={dict.tour.timeAllocationAria}>
            {(['watch', 'skim', 'listen'] as TourMode[]).map((m) => (
              <span
                key={m}
                className={styles[`prop_${m}`]}
                style={{ width: `${(agg[m] / total) * 100}%` }}
              />
            ))}
          </div>
          <div className={styles.propLegend}>
            <span><i className={styles.prop_watch} /> {dict.tour.legendWatch(mmss(agg.watch))}</span>
            <span><i className={styles.prop_skim} /> {dict.tour.legendSkim(mmss(agg.skim))}</span>
            <span><i className={styles.prop_listen} /> {dict.tour.legendListen(mmss(agg.listen))}</span>
          </div>
        </div>

        {tour.ifShortOnTime && (
          <div className={styles.short}>
            <span className={styles.shortLabel}>{dict.tour.shortOnTime}</span>
            <span>{tour.ifShortOnTime}</span>
          </div>
        )}
      </div>

      <section className={styles.section} id="stops">
        <h3 className={styles.sectionHead}>{dict.tour.stopsHeading}</h3>
        <div className={styles.modes}>
          {(['watch', 'skim', 'listen'] as TourMode[]).map((m) => (
            <span key={m} className={styles.modeItem}>
              <span className={`${styles.badge} ${styles[`badge_${m}`]}`}>{modeLabel[m]}</span>
              {modeHint[m]}
            </span>
          ))}
        </div>

        <ol className={styles.stops}>
          {tour.stops.map((st, i) => (
            <li key={i} className={styles.stop}>
              <div className={styles.stime}>
                {mmss(st.startSeconds)}
                <span className={styles.to}>→ {mmss(st.endSeconds)}</span>
              </div>
              <div className={styles.stbody}>
                <span className={`${styles.badge} ${styles[`badge_${st.howTo}`]}`}>
                  {modeLabel[st.howTo]}
                </span>
                <h4 className={styles.stTitle}>{st.title}</h4>
                {st.what && <p className={styles.what}>{st.what}</p>}
                {st.keyPoint && (
                  <p className={styles.key}>
                    <span className={styles.keyLabel}>{dict.tour.keyPointLabel}</span>
                    {st.keyPoint}
                  </p>
                )}
                <div className={styles.strow}>
                  {st.howToReason && <span className={styles.reason}>{st.howToReason}</span>}
                  <a
                    href={at(officialUrl, st.startSeconds)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.jump}
                  >
                    {dict.tour.jumpTo(mmss(st.startSeconds))}
                  </a>
                </div>
                {displayableSpeaker(st.speaker) && (
                  <div className={styles.spk}>{dict.tour.speaker(displayableSpeaker(st.speaker)!)}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
