import type { Metadata } from 'next';
import { getConferences, getDigestByConference } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { renderRich } from '@/i18n/rich';
import { ConfBadge } from '@/components/ConfBadge/ConfBadge';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import styles from './home.module.css';

/**
 * / — 站点首页（中文，默认 locale，无前缀）：多会议入口。
 *
 * 上线场次已跨会议（Cursor Compile + Figma Config），首页不再是某一会议的
 * 硬编码 hub（那是早期只有一场会议时的做法，见 src/app/_compile/），而是
 * 列出全部已发布会议、各自导向 /c/{conferenceId}。新开一场会议只需
 * data/publish.json 打开开关 + 重新构建，首页与路由自动补上，无需改代码。
 * 英文版见 /en（src/app/en/page.tsx），同一套组件，locale='en'。
 */
const dict = getDictionary('zh');

export const metadata: Metadata = {
  title: `${dict.site.name} — ${dict.site.tagline}`,
  description: dict.site.description,
  alternates: { languages: { 'zh-CN': '/', en: '/en/' } },
};

export default function HomePage() {
  const conferences = getConferences()
    .filter((c) => c.sessionCount > 0)
    .slice()
    .sort((a, b) => b.sessionCount - a.sessionCount);

  return (
    <SiteChrome locale="zh">
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
                  <a className={styles.confCard} href={`/c/${conf.id}/`}>
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
