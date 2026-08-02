import { getAllSessions, getConferences, getDigestByConference } from '@/lib/loader';
import { conferenceMeta } from '@/design/tokens';
import { getDictionary } from '@/i18n/getDictionary';
import type { Locale } from '@/i18n/locale';
import { frameSrc } from '@/lib/assets';
import { conferenceCover, conferenceStats, personaStats } from '@/lib/browseStats';
import { PERSONA_KICKER, PERSONA_ROLE, PERSONA_SLUGS } from '@/lib/personas';
import styles from './HomeIndex.module.css';

/**
 * HomeIndex — 首页引导页（/ 与 /en）。
 *
 * 改版要点：首页不再直接铺 167 条列表。同一场大会里工程师该看的和设计师该看的
 * 根本不是同几场，把全量列表当首屏等于把这个分流工作丢给读者。现在先分流——
 * 「你是谁」（角色入口 → /for/{persona}）或「哪场大会」（会议卡 → /c/{id}），
 * 列表页退到这两个入口之后。
 */
const ARCHIVE_MONTH = '2026.07';

export function HomeIndex({ locale }: { locale: Locale }) {
  const dict = getDictionary(locale);
  const prefix = locale === 'en' ? '/en' : '';
  const sessions = getAllSessions(locale);
  const conferences = getConferences()
    .filter((c) => c.sessionCount > 0)
    .slice()
    .sort((a, b) => b.sessionCount - a.sessionCount);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <section className={styles.hero}>
          <div className={styles.heroMain}>
            <span className={styles.eyebrow}>{dict.home.archiveLine(ARCHIVE_MONTH)}</span>
            <h1 className={styles.h1}>{dict.home.indexHeadline}</h1>
            <p className={styles.lead}>
              {dict.home.indexLead(conferences.length, sessions.length)}
            </p>
          </div>
          <div className={styles.howTo}>
            <span className={styles.howToHead}>{dict.home.howToHeading}</span>
            {dict.home.howTo.map((text, i) => (
              <span key={i} className={styles.howToRow}>
                <span className={styles.howToNum}>{String(i + 1).padStart(2, '0')}</span>
                <span>{text}</span>
              </span>
            ))}
          </div>
        </section>

        {/* 角色入口：每格给出「多少场相关 / 共多少分钟必看」，让人一眼判断值不值得进。 */}
        <ul className={styles.personaGrid}>
          {PERSONA_SLUGS.map((slug) => {
            const stats = personaStats(sessions, PERSONA_ROLE[slug]);
            const p = dict.personas[slug];
            return (
              <li key={slug} className={styles.personaCell}>
                <a className={styles.personaCard} href={`${prefix}/for/${slug}/`}>
                  <span className={styles.personaKicker}>{PERSONA_KICKER[slug]}</span>
                  <span className={styles.personaWho}>{p.who}</span>
                  <span className={styles.personaCare}>{p.care}</span>
                  <span className={styles.personaStats}>
                    <span className={styles.personaN}>{dict.home.personaRelated(stats.talks)}</span>
                    <span className={styles.personaMins}>
                      {dict.home.personaMins(stats.mustWatchMinutes)}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>

        {/* 会议卡：封面用该会议站内留存的真实关键画面（见 conferenceCover）。 */}
        <ul className={styles.confGrid}>
          {conferences.map((conf) => {
            const digest = getDigestByConference(conf.id, locale);
            const stats = conferenceStats(sessions, conf.id);
            const cover = conferenceCover(sessions, conf.id);
            return (
              <li key={conf.id}>
                <a className={styles.confCard} href={`${prefix}/c/${conf.id}/`}>
                  <span className={styles.confCover}>
                    {cover && (
                      // 静态导出：用原生 img 避免 next/image 的运行时优化依赖。
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className={styles.confCoverImg}
                        src={frameSrc(cover.src)}
                        alt={cover.alt}
                        loading="lazy"
                        width={640}
                        height={360}
                      />
                    )}
                  </span>
                  <span className={styles.confBody}>
                    <span className={styles.confName}>{conferenceMeta[conf.id].label}</span>
                    {digest?.headline && <span className={styles.confHook}>{digest.headline}</span>}
                    <span className={styles.confFoot}>
                      <span className={styles.confCount}>
                        {dict.home.sessionCount(stats.talks)}
                      </span>
                      <span className={styles.confEnter}>{dict.home.enter}</span>
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
