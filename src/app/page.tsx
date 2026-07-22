import type { Metadata } from 'next';
import { getConferences, getDigestByConference } from '@/lib/loader';
import { ConfBadge } from '@/components/ConfBadge/ConfBadge';
import styles from './home.module.css';

/**
 * / — 站点首页：多会议入口。
 *
 * 上线场次已跨会议（Cursor Compile + Figma Config），首页不再是某一会议的
 * 硬编码 hub（那是早期只有一场会议时的做法，见 src/app/_compile/），而是
 * 列出全部已发布会议、各自导向 /c/{conferenceId}。新开一场会议只需
 * data/publish.json 打开开关 + 重新构建，首页与路由自动补上，无需改代码。
 */
export const metadata: Metadata = {
  title: 'AI Conference Compass — AI 大会观看导览',
  description:
    '把 AI 大会演讲扒成可读的观看导览：跨场信号、每场的钩子与必看片段、逐段告诉你该看画面还是听就够，全部配官方原片时间戳深链。',
};

export default function HomePage() {
  const conferences = getConferences()
    .filter((c) => c.sessionCount > 0)
    .slice()
    .sort((a, b) => b.sessionCount - a.sessionCount);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <header className={styles.hero}>
          <span className={styles.eyebrow}>AI 大会导览</span>
          <h1 className={styles.h1}>AI Conference Compass</h1>
          <p className={styles.lead}>
            把 AI 大会演讲扒成可读的观看导览——一句话钩子、谁该看、时间不够看哪段、
            逐段告诉你该 <b>看画面</b> 还是 <b>略读</b> 或 <b>听就够</b>，配官方原片时间戳深链。
          </p>
        </header>

        <ul className={styles.confList}>
          {conferences.map((conf) => {
            const digest = getDigestByConference(conf.id);
            return (
              <li key={conf.id}>
                <a className={styles.confCard} href={`/c/${conf.id}/`}>
                  <ConfBadge conference={conf.id} />
                  <span className={styles.confCount}>{conf.sessionCount} 场演讲</span>
                  {digest?.headline && <p className={styles.confTeaser}>{digest.headline}</p>}
                  <span className={styles.confCta}>查看导览 →</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
