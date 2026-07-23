'use client';

import { usePathname } from 'next/navigation';
import type { Locale } from '@/i18n/locale';
import styles from './LanguageSwitcher.module.css';

/** 当前路径 → 另一 locale 下同一页面的路径。trailingSlash:true，路径恒以 / 结尾。 */
export function counterpartPath(pathname: string, currentLocale: Locale): string {
  if (currentLocale === 'en') {
    if (pathname === '/en/' || pathname === '/en') return '/';
    return pathname.replace(/^\/en/, '') || '/';
  }
  return pathname === '/' ? '/en/' : `/en${pathname}`;
}

/**
 * LanguageSwitcher — 跳转到当前页面的另一语言版本（保留路径，不是跳回首页）。
 * 客户端组件：usePathname() 读运行时实际 URL，静态导出下同样可用。
 */
export function LanguageSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const pathname = usePathname();
  const href = counterpartPath(pathname, locale);
  return (
    <a className={styles.link} href={href}>
      {label}
    </a>
  );
}
