import { getAllSessions, getConferenceById, getDigestByConference } from '@/lib/loader';
import type { ConferenceId } from '@/lib/schema';
import { conferenceMeta } from '@/design/tokens';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import { conferenceStats } from '@/lib/browseStats';
import { SessionPicker } from '@/components/SessionPicker/SessionPicker';
import { buildPickerProps } from '@/components/SessionPicker/buildPickerProps';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import styles from './ConferenceHub.module.css';

/**
 * ConferenceHub — 会议页（/c/{conferenceId} 与 /en/c/{conferenceId}）。
 *
 * 改版：页头给出这场大会的定位（钩子 + 三个硬数字）与「讲了什么」的主题清单，
 * 下面直接是已按该会议收窄的列表，与角色页同一套 SessionPicker。
 *
 * 相比旧版去掉了两样东西：一是把导览已就绪的场次单独列成大卡片墙（现在全部
 * 场次都有导览，这个区分已无意义）；二是把 digest 的全文信号面板铺在页面底部
 * （信息量大但没人滚到那里，改为页头右侧的主题清单，各条只留标题）。
 *
 * 按 conferenceId 参数化，新开一场会议无需新写组件——只要该会议有已发布场次，
 * 路由会自动生成（见 app/c/[conferenceId]/page.tsx 的 generateStaticParams）。
 */
export function ConferenceHub({
  conferenceId,
  locale,
}: {
  conferenceId: ConferenceId;
  locale: Locale;
}) {
  const dict = getDictionary(locale);
  const prefix = locale === 'en' ? '/en' : '';
  const conf = getConferenceById(conferenceId);
  const all = getAllSessions(locale);
  const own = all.filter((s) => s.conferenceId === conferenceId);
  const stats = conferenceStats(all, conferenceId);
  const digest = getDigestByConference(conferenceId, locale);
  const name = conf ? conferenceMeta[conferenceId].label : conferenceId;

  const pickerProps = buildPickerProps(own, dict, locale);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb
          ariaLabel={dict.breadcrumb.ariaLabel}
          items={[{ label: dict.breadcrumb.home, href: `${prefix}/` }, { label: name }]}
        />

        <header className={styles.head}>
          <div className={styles.headMain}>
            <span className={styles.eyebrow}>{dict.hub.eyebrow}</span>
            <h1 className={styles.h1}>{name}</h1>
            {digest?.headline && <p className={styles.hook}>{digest.headline}</p>}
            <div className={styles.stats}>
              <span className={styles.stat}>
                <span className={styles.statNum}>{stats.talks}</span>
                <span className={styles.statLabel}>{dict.confPage.statTalks}</span>
              </span>
              <span className={styles.stat}>
                <span className={styles.statNumAccent}>{stats.mustWatchTalks}</span>
                <span className={styles.statLabel}>{dict.confPage.statMustWatch}</span>
              </span>
              <span className={styles.stat}>
                <span className={styles.statNum}>{stats.hours}</span>
                <span className={styles.statLabel}>{dict.confPage.statHours}</span>
              </span>
            </div>
          </div>

          {/* 「讲了什么」：digest 的信号标题清单。无 digest 的会议整块不渲染，不占位。 */}
          {digest && digest.signals.length > 0 && (
            <div className={styles.themes}>
              <span className={styles.themesHead}>{dict.confPage.themesHeading}</span>
              {digest.signals.map((sig, i) => (
                <div key={i} className={styles.theme}>
                  <span className={styles.themeNum}>{String(i + 1).padStart(2, '0')}</span>
                  <span className={styles.themeText}>{sig.title}</span>
                </div>
              ))}
            </div>
          )}
        </header>

        {/* conferences=[] → 隐藏「会议」那一轴：已经按会议进来了，不再重复给同维度筛选。 */}
        <SessionPicker {...pickerProps} conferences={[]} />
      </div>
    </main>
  );
}
