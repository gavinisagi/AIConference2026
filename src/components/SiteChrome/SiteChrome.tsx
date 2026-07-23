import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import { renderRich } from '@/i18n/rich';
import { LanguageSwitcher } from '@/components/LanguageSwitcher/LanguageSwitcher';
import styles from './SiteChrome.module.css';

/**
 * SiteChrome — 站点级外壳：语言切换条 + 页面内容 + 归属/免责页脚。
 *
 * 中文路由与 /en 镜像路由各自显式传入 locale 并包一层本组件，取代过去直接写在
 * 根 layout.tsx 里的做法——根 layout 拿不到 locale（不在 [locale] 动态段下，
 * 见 src/i18n/locale.ts 顶部注释的取舍说明），页脚与语言相关文案得在这一层解决。
 */
export function SiteChrome({ locale, children }: { locale: Locale; children: ReactNode }) {
  const dict = getDictionary(locale);
  return (
    <>
      <div className={styles.langBar}>
        <div className={styles.langBarInner}>
          <LanguageSwitcher locale={locale} label={dict.languageSwitcher.label} />
        </div>
      </div>

      {children}

      <footer className={styles.siteFoot}>
        <div className={styles.siteFootInner}>
          <p className={styles.footLine}>{renderRich(dict.site.footerDisclaimer())}</p>
          <p className={styles.footLine}>{renderRich(dict.site.footerMethod())}</p>
        </div>
      </footer>
    </>
  );
}
