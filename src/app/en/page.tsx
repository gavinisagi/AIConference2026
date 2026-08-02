import type { Metadata } from 'next';
import { getDictionary } from '@/i18n/getDictionary';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import { HomeIndex } from '@/components/HomeIndex/HomeIndex';

/**
 * /en — 英文首页。中文原版见 src/app/page.tsx；两者共用 HomeIndex，
 * 只是显式传入 locale='en'（非 [locale] 动态段方案，见 src/i18n/locale.ts）。
 */
const dict = getDictionary('en');

export const metadata: Metadata = {
  title: `${dict.site.name} — ${dict.site.tagline}`,
  description: dict.site.description,
  alternates: { languages: { 'zh-CN': '/', en: '/en/' } },
};

export default function HomePageEn() {
  return (
    <SiteChrome locale="en">
      <HomeIndex locale="en" />
    </SiteChrome>
  );
}
