import type { Metadata } from 'next';
import { getAllSessions, getConferences } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { ConfBadge } from '@/components/ConfBadge/ConfBadge';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import { SessionPicker } from '@/components/SessionPicker/SessionPicker';
import { buildPickerProps } from '@/components/SessionPicker/buildPickerProps';
import styles from './home.module.css';

/**
 * / — 站点首页（中文，默认 locale，无前缀）：选片入口。
 *
 * 改版前首页只有三张会议卡，要多点一次才看到演讲。现在直接把全部已发布场次铺成
 * 可筛选列表——按会议 / 场景 / 谁该看 / 主题挑，每行右侧给出「必看 N 分钟」，
 * 一屏内就能决定看哪场；会议卡退为顶部的快捷入口（各自仍导向 /c/{id} hub）。
 * 新开一场会议只需 data/publish.json 打开开关 + 重新构建，无需改代码。
 * 英文版见 /en（src/app/en/page.tsx），同一套组件，locale='en'。
 */
const dict = getDictionary('zh');
const ARCHIVE_MONTH = '2026.07';

export const metadata: Metadata = {
  title: `${dict.site.name} — ${dict.site.tagline}`,
  description: dict.site.description,
  alternates: { languages: { 'zh-CN': '/', en: '/en/' } },
};

export default function HomePage() {
  const sessions = getAllSessions();
  const conferences = getConferences()
    .filter((c) => c.sessionCount > 0)
    .slice()
    .sort((a, b) => b.sessionCount - a.sessionCount);

  return (
    <SiteChrome locale="zh">
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
                <a className={styles.confLink} href={`/c/${conf.id}/`}>
                  <ConfBadge conference={conf.id} />
                  <span className={styles.confCount}>
                    {dict.home.sessionCount(conf.sessionCount)}
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <SessionPicker {...buildPickerProps(sessions, dict, 'zh')} />
        </div>
      </main>
    </SiteChrome>
  );
}
