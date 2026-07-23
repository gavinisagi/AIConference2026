import type { Metadata } from 'next';
import { getConferences, getDigestByConference } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { renderRich } from '@/i18n/rich';
import { ConfBadge } from '@/components/ConfBadge/ConfBadge';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import styles from '../home.module.css';

/**
 * /en — 英文首页。中文原版见 src/app/page.tsx；两者共享同一份 home.module.css
 * 与组件，只是显式传入 locale='en'（非 [locale] 动态段方案，见 src/i18n/locale.ts）。
 */
const dict = getDictionary('en');

export const metadata: Metadata = {
  title: `${dict.site.name} — ${dict.site.tagline}`,
  description: dict.site.description,
};

export default function HomePageEn() {
  const conferences = getConferences()
    .filter((c) => c.sessionCount > 0)
    .slice()
    .sort((a, b) => b.sessionCount - a.sessionCount);

  return (
    <SiteChrome locale="en">
      <main className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.hero}>
            <span className={styles.eyebrow}>{dict.home.eyebrow}</span>
            <h1 className={styles.h1}>AI Conference Compass</h1>
            <p className={styles.lead}>{renderRich(dict.home.lead())}</p>
          </header>

          <ul className={styles.confList}>
            {conferences.map((conf) => {
              const digest = getDigestByConference(conf.id);
              return (
                <li key={conf.id}>
                  <a className={styles.confCard} href={`/en/c/${conf.id}/`}>
                    <ConfBadge conference={conf.id} />
                    <span className={styles.confCount}>{dict.home.sessionCount(conf.sessionCount)}</span>
                    {digest?.headline && <p className={styles.confTeaser}>{digest.headline}</p>}
                    <span className={styles.confCta}>{dict.home.viewTour}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
    </SiteChrome>
  );
}
