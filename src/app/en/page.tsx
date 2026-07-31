import type { Metadata } from 'next';
import { getAllSessions, getConferences } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { ConfBadge } from '@/components/ConfBadge/ConfBadge';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import { SessionPicker } from '@/components/SessionPicker/SessionPicker';
import { buildPickerProps } from '@/components/SessionPicker/buildPickerProps';
import styles from '../home.module.css';

/**
 * /en — 英文首页。中文原版见 src/app/page.tsx；两者共享同一份 home.module.css
 * 与组件，只是显式传入 locale='en'（非 [locale] 动态段方案，见 src/i18n/locale.ts）。
 */
const dict = getDictionary('en');
const ARCHIVE_MONTH = '2026.07';

export const metadata: Metadata = {
  title: `${dict.site.name} — ${dict.site.tagline}`,
  description: dict.site.description,
  alternates: { languages: { 'zh-CN': '/', en: '/en/' } },
};

export default function HomePageEn() {
  const sessions = getAllSessions('en');
  const conferences = getConferences()
    .filter((c) => c.sessionCount > 0)
    .slice()
    .sort((a, b) => b.sessionCount - a.sessionCount);

  return (
    <SiteChrome locale="en">
      <main className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.hero}>
            <span className={styles.eyebrow}>{dict.home.archiveLine(ARCHIVE_MONTH)}</span>
            <h1 className={styles.h1}>{dict.home.headline(sessions.length)}</h1>
            <p className={styles.lead}>{dict.home.subLead}</p>
          </header>

          <ul className={styles.confRail}>
            {conferences.map((conf) => (
              <li key={conf.id}>
                <a className={styles.confLink} href={`/en/c/${conf.id}/`}>
                  <ConfBadge conference={conf.id} />
                  <span className={styles.confCount}>
                    {dict.home.sessionCount(conf.sessionCount)}
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <SessionPicker {...buildPickerProps(sessions, dict, 'en')} />
        </div>
      </main>
    </SiteChrome>
  );
}
