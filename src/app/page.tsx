import type { Metadata } from 'next';
import { getAllSessions } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import { SessionPicker } from '@/components/SessionPicker/SessionPicker';
import { buildPickerProps } from '@/components/SessionPicker/buildPickerProps';
import styles from './home.module.css';

/**
 * / — 站点首页（中文，默认 locale，无前缀）：选片入口。
 *
 * 全部已发布场次铺成可筛选列表——按会议 / 场景 / 谁该看 / 主题挑，每行右侧给出
 * 「必看 N 分钟」，一屏内就能决定看哪场。此前顶部还有一排会议快捷卡片，但它的
 * 功能已被筛选器的「会议」轴完全覆盖——两处都能按会议过滤，卡片纯属冗余，
 * 已删除（2026-08 修正）。要看某会议的整体信号，去 /c/{id} hub 页。
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

  return (
    <SiteChrome locale="zh">
      <main className={styles.page}>
        <div className={styles.inner}>
          <header className={styles.hero}>
            <span className={styles.eyebrow}>{dict.home.archiveLine(ARCHIVE_MONTH)}</span>
            <h1 className={styles.h1}>{dict.home.headline(sessions.length)}</h1>
            <p className={styles.lead}>{dict.home.subLead}</p>
          </header>

          <SessionPicker {...buildPickerProps(sessions, dict, 'zh')} />
        </div>
      </main>
    </SiteChrome>
  );
}
