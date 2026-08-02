import { getAllSessions } from '@/lib/loader';
import { getDictionary } from '@/i18n/getDictionary';
import type { Locale } from '@/i18n/locale';
import { personaStats } from '@/lib/browseStats';
import { PERSONA_KICKER, PERSONA_ROLE, type PersonaSlug } from '@/lib/personas';
import { SessionPicker } from '@/components/SessionPicker/SessionPicker';
import { buildPickerProps } from '@/components/SessionPicker/buildPickerProps';
import { Breadcrumb } from '@/app/_shared/Breadcrumb';
import styles from './PersonaView.module.css';

/**
 * PersonaView — 角色浏览页（/for/{persona}）。
 *
 * 从首页角色入口进来后落到这里：先用页头确认「你是谁、这里有多少东西」，
 * 再给已经按角色收窄过的列表。列表本身复用首页那套 SessionPicker——
 * 唯一区别是数据在服务端就已按角色过滤，且不再显示「谁该看」那一轴筛选
 * （已经按角色进来了，再给一次同维度筛选是噪音）。
 */
export function PersonaView({ persona, locale }: { persona: PersonaSlug; locale: Locale }) {
  const dict = getDictionary(locale);
  const prefix = locale === 'en' ? '/en' : '';
  const role = PERSONA_ROLE[persona];
  const all = getAllSessions(locale);
  const mine = all.filter((s) => s.roles.includes(role));
  const stats = personaStats(all, role);
  const p = dict.personas[persona];

  const pickerProps = buildPickerProps(mine, dict, locale);

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb
          ariaLabel={dict.breadcrumb.ariaLabel}
          items={[{ label: dict.breadcrumb.home, href: `${prefix}/` }, { label: p.who }]}
        />

        <header className={styles.head}>
          <div className={styles.headMain}>
            <span className={styles.eyebrow}>
              {dict.personaPage.eyebrow(PERSONA_KICKER[persona])}
            </span>
            <h1 className={styles.h1}>{p.who}</h1>
            <p className={styles.lead}>{dict.personaPage.lead(p.care)}</p>
          </div>
          <div className={styles.stats}>
            <span className={styles.stat}>
              <span className={styles.statNum}>{stats.talks}</span>
              <span className={styles.statLabel}>{dict.personaPage.statTalks}</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statNumAccent}>{stats.mustWatchMinutes}</span>
              <span className={styles.statLabel}>{dict.personaPage.statMins}</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statNum}>{stats.conferences}</span>
              <span className={styles.statLabel}>{dict.personaPage.statConfs}</span>
            </span>
          </div>
        </header>

        {/* roles=[] → 隐藏「谁该看」那一轴：已经按角色进来了，不再重复给同维度筛选。 */}
        <SessionPicker {...pickerProps} roles={[]} />
      </div>
    </main>
  );
}
