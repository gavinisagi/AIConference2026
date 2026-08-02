import type { Metadata } from 'next';
import { getDictionary } from '@/i18n/getDictionary';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';
import { HomeIndex } from '@/components/HomeIndex/HomeIndex';

/**
 * / — 站点首页（中文，默认 locale，无前缀）：引导页。
 *
 * 不再直接铺全量列表——同一场大会里工程师该看的和设计师该看的不是同几场，
 * 首屏铺 167 条等于把分流工作丢给读者。改为先分流：角色入口（/for/{persona}）
 * 或会议入口（/c/{id}），列表退到这两个入口之后。详见 HomeIndex。
 * 英文版见 /en（src/app/en/page.tsx），同一套组件，locale='en'。
 */
const dict = getDictionary('zh');

export const metadata: Metadata = {
  title: `${dict.site.name} — ${dict.site.tagline}`,
  description: dict.site.description,
  alternates: { languages: { 'zh-CN': '/', en: '/en/' } },
};

export default function HomePage() {
  return (
    <SiteChrome locale="zh">
      <HomeIndex locale="zh" />
    </SiteChrome>
  );
}
