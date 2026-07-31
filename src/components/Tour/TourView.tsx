import type { SessionFrame, Tour } from '@/lib/schema';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import { renderRich } from '@/i18n/rich';
import { frameSrc } from '@/lib/assets';
import { watchSplit } from '@/lib/watchStats';
import { TourDepths, type BarSegment } from './TourDepths';
import styles from './TourView.module.css';

/**
 * TourView — 观看导览（承接层核心体验）。
 *
 * 分三档阅读深度（见 TourDepths）：
 *   TL;DR   — 关键观点 + 谁该看 + 我们的建议，30 秒内决定看不看；
 *   读完    — 逐段导览 + 关键画面侧栏，不看原片也能拿到内容；
 *   跳看    — 必看播放列表 + 其余可跳段落 + 官方原片入口。
 * 本组件负责在服务端渲染这三块，切换逻辑在客户端。所有深链外跳官方源带时间戳
 * （本站不播放）。locale 驱动 UI 框架文案与正文（英文版数据集已整体替换）。
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

  // 「盯屏 X 分钟」「必看点数」「播放列表时长」三个数全部出自这一份 split——
  // 不允许各区块各算各的（stops.howTo 与 mustWatch 区间此前独立聚合，
  // 曾在同一屏出现"必看 0 分钟"又"播放列表 11 min"的自相矛盾）。
  const split = watchSplit(tour);
  const durationSec = tour.stops.reduce((mx, s) => Math.max(mx, s.endSeconds), 0);
  const watchMin = split.watchMinutes;
  const totalMin = minutesOf(durationSec);
  const mustWatchMin = minutesOf(
    tour.mustWatch.reduce((sum, m) => sum + Math.max(0, m.endSeconds - m.startSeconds), 0),
  );

  // 顶部常驻时间轴：一格一站，宽度按时长占比，点击跳原片；落在必看并集区间内的
  // 站一律显示为「看」色，即便该站自身 howTo 标的是 skim/listen（并集口径，见上）。
  const watchRanges: { startSeconds: number; endSeconds: number }[] = [
    ...tour.stops.filter((s) => s.howTo === 'watch'),
    ...tour.mustWatch,
  ];
  const inWatchUnion = (s: number, e: number) =>
    watchRanges.some((r) => r.startSeconds < e && r.endSeconds > s);
  const barSegments: BarSegment[] = tour.stops.map((st) => ({
    pct: Math.max(1, ((st.endSeconds - st.startSeconds) / split.totalSeconds) * 100),
    start: mmss(st.startSeconds),
    title: `${mmss(st.startSeconds)}–${mmss(st.endSeconds)} ${st.title}`,
    href: at(officialUrl, st.startSeconds),
    mode: st.howTo === 'watch' || inWatchUnion(st.startSeconds, st.endSeconds) ? 'watch' : st.howTo,
  }));

  /* ---- 档位 1：TL;DR —— 关键观点 + 谁该看 + 建议 ---- */
  const panelTldr = (
    <div className={styles.tldrGrid}>
      <div className={styles.tldrMain}>
        {tour.stops.some((s) => s.keyPoint) && (
          <>
            <span className={styles.miniHead}>{dict.video.takeawaysHeading}</span>
            <ol className={styles.pointList}>
              {tour.stops
                .filter((s) => s.keyPoint)
                .map((s, i) => (
                  <li key={i} className={styles.point}>
                    <p className={styles.pointText}>{s.keyPoint}</p>
                    <a
                      className={styles.pointAt}
                      href={at(officialUrl, s.startSeconds)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {mmss(s.startSeconds)} – {mmss(s.endSeconds)}
                    </a>
                  </li>
                ))}
            </ol>
          </>
        )}
      </div>
      <aside className={styles.tldrSide}>
        {/* audience 有结构化列表时用它（含「不适合谁」）；否则回落 whoShouldWatch 单句。 */}
        {tour.audience.length > 0 ? (
          <div className={styles.sideBlock}>
            <span className={styles.sideHead}>{dict.tour.whoShouldWatch}</span>
            {tour.audience.map((a, i) => (
              <div key={i} className={styles.audItem}>
                <span className={a.fit === 'not_recommended' ? styles.audWhoNo : styles.audWho}>
                  {a.fit === 'not_recommended' ? `${dict.tour.notRecommended} · ${a.who}` : a.who}
                </span>
                <span className={styles.audWhy}>{a.why}</span>
              </div>
            ))}
          </div>
        ) : (
          tour.whoShouldWatch && (
            <div className={styles.sideBlock}>
              <span className={styles.sideHead}>{dict.tour.whoShouldWatch}</span>
              <span className={styles.audWhy}>{tour.whoShouldWatch}</span>
            </div>
          )
        )}
        <div className={styles.advice}>
          <span className={styles.sideHead}>{dict.tour.ourAdvice}</span>
          <span className={styles.adviceText}>
            {dict.tour.adviceLine(totalMin, watchMin)}
            {split.watchPct <= 10 && ` ${dict.tour.adviceCommute}`}
          </span>
          {tour.ifShortOnTime && <span className={styles.adviceText}>{tour.ifShortOnTime}</span>}
        </div>
      </aside>
    </div>
  );

  /* ---- 档位 2：读完 —— 逐段导览 + 关键画面侧栏 ---- */
  const panelRead = (
    <div className={styles.readGrid}>
      <div className={styles.readMain}>
        <span className={styles.miniHead}>{dict.tour.readerCount(tour.stops.length)}</span>
        <ol className={styles.stops}>
          {tour.stops.map((st, i) => (
            <li key={i} className={styles.stop}>
              <div className={styles.stime}>
                {mmss(st.startSeconds)}{' '}
                <span className={styles.to}>– {mmss(st.endSeconds)}</span>
                <span className={`${styles.badge} ${styles[`badge_${st.howTo}`]}`}>
                  {modeLabel[st.howTo]}
                </span>
              </div>
              <div className={styles.stbody}>
                <h4 className={styles.stTitle}>{st.title}</h4>
                {st.what && <p className={styles.what}>{st.what}</p>}
                {st.keyPoint && <p className={styles.key}>{st.keyPoint}</p>}
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
                  <div className={styles.spk}>
                    {dict.tour.speaker(displayableSpeaker(st.speaker)!)}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      {frames.length > 0 && (
        <aside className={styles.frameRail}>
          <span className={styles.railHead}>
            <span>{dict.tour.framesHeading}</span>
            <span className={styles.railCount}>{frames.length}</span>
          </span>
          <div className={styles.railList}>
            {frames.map((f) => (
              <a
                key={f.src}
                className={styles.railItem}
                href={at(officialUrl, f.timestampSeconds)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {/* 静态导出：用原生 img 避免 next/image 的运行时优化依赖。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.railImg}
                  src={frameSrc(f.src)}
                  alt={f.caption || dict.tour.frameAlt(mmss(f.timestampSeconds))}
                  loading="lazy"
                  width={224}
                  height={126}
                />
                <span className={styles.railMeta}>
                  <span className={styles.railTime}>{mmss(f.timestampSeconds)}</span>
                  {f.caption && <span className={styles.railCaption}>{f.caption}</span>}
                </span>
              </a>
            ))}
          </div>
        </aside>
      )}
    </div>
  );

  /* ---- 档位 3：跳看原片 —— 必看播放列表 + 其余可跳 + 官方入口 ---- */
  const restStops = tour.stops.filter((s) => s.howTo !== 'watch');
  const panelWatch = (
    <div className={styles.watchGrid}>
      <div className={styles.watchMain}>
        {tour.mustWatch.length > 0 ? (
          <>
            <div className={styles.playlistHead}>
              <span className={styles.playlistTitle}>
                {dict.tour.playlistHeading(tour.mustWatch.length, mustWatchMin)}
              </span>
              <span className={styles.playlistNote}>{dict.tour.playlistNote}</span>
            </div>
            <ol className={styles.mustList}>
              {tour.mustWatch.map((m, i) => (
                <li key={i} className={styles.mustRow}>
                  <span className={styles.mustBody}>
                    <span className={styles.mustTime}>
                      {mmss(m.startSeconds)} – {mmss(m.endSeconds)}
                      {m.live && <span className={styles.live}>{dict.tour.liveBadge}</span>}
                    </span>
                    <span className={styles.mustLabel}>{m.label}</span>
                    {m.why && <span className={styles.mustWhy}>{m.why}</span>}
                  </span>
                  <a
                    className={styles.playBtn}
                    href={at(officialUrl, m.startSeconds)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {dict.tour.play}
                  </a>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <span className={styles.miniHead}>{dict.tour.mustWatchHeading}</span>
        )}

        {restStops.length > 0 && (
          <div className={styles.restBlock}>
            <span className={styles.miniHead}>{dict.tour.restHeading}</span>
            {restStops.map((s, i) => (
              <div key={i} className={styles.restRow}>
                <span className={styles.restTime}>
                  {mmss(s.startSeconds)} – {mmss(s.endSeconds)}
                </span>
                <span className={`${styles.badge} ${styles[`badge_${s.howTo}`]}`}>
                  {modeLabel[s.howTo]}
                </span>
                <span className={styles.restTitle}>{s.title}</span>
                <a
                  className={styles.restJump}
                  href={at(officialUrl, s.startSeconds)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {dict.tour.jump}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className={styles.watchSide}>
        <span className={styles.sideHead}>{dict.tour.officialSourceHeading}</span>
        <a
          className={styles.officialBtn}
          href={officialUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {dict.video.watchButton}
        </a>
        <span className={styles.officialNote}>{dict.video.watchNote}</span>
        <div className={styles.advice}>
          <span className={styles.sideHead}>{dict.tour.ourAdvice}</span>
          <span className={styles.adviceText}>
            {dict.tour.adviceLine(totalMin, watchMin)}
            {split.watchPct <= 10 && ` ${dict.tour.adviceCommute}`}
          </span>
        </div>
      </aside>
    </div>
  );

  return (
    <div className={styles.tour}>
      {/* 钩子已升级为页面 h1（VideoDetailView），这里不再重复渲染一遍。 */}

      {/* 一行硬统计：全片多长 · 真正值得盯屏多久 · 几个必看点。 */}
      <p className={styles.statline}>
        {renderRich(dict.tour.statFullLength(totalMin))}
        <span className={styles.statDot}>·</span>
        {renderRich(dict.tour.statWatchLength(watchMin), styles.statWatch)}
        {tour.mustWatch.length > 0 && (
          <>
            <span className={styles.statDot}>·</span>
            {renderRich(dict.tour.statMustWatch(tour.mustWatch.length))}
          </>
        )}
      </p>

      <TourDepths
        tabs={[
          {
            key: 'tldr',
            label: dict.tour.depth.tldrLabel,
            hint: dict.tour.depth.tldrHint(tour.stops.filter((s) => s.keyPoint).length),
          },
          { key: 'read', label: dict.tour.depth.readLabel, hint: dict.tour.depth.readHint },
          {
            key: 'watch',
            label: dict.tour.depth.watchLabel,
            hint: dict.tour.depth.watchHint(mustWatchMin || watchMin),
          },
        ]}
        segments={barSegments}
        legendMustWatch={dict.tour.legendMustWatch(watchMin)}
        legendRest={dict.tour.legendRest}
        barAriaLabel={dict.tour.segmentBarAria}
        tabsAriaLabel={dict.tour.depth.ariaLabel}
        panels={{ tldr: panelTldr, read: panelRead, watch: panelWatch }}
      />
    </div>
  );
}
