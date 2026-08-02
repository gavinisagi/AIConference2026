import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDictionary } from '@/i18n/getDictionary';
import { PERSONA_SLUGS, isPersonaSlug } from '@/lib/personas';
import { PersonaView } from '@/components/PersonaView/PersonaView';
import { SiteChrome } from '@/components/SiteChrome/SiteChrome';

/**
 * /for/{persona} — 角色浏览页（中文）。英文镜像见 /en/for/{persona}。
 * 四个 persona 与契约里的 Role 枚举一一对应，见 src/lib/personas.ts。
 */
const dict = getDictionary('zh');

export function generateStaticParams(): Array<{ persona: string }> {
  return PERSONA_SLUGS.map((persona) => ({ persona }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ persona: string }>;
}): Promise<Metadata> {
  const { persona } = await params;
  if (!isPersonaSlug(persona)) return { title: dict.site.name };
  const p = dict.personas[persona];
  return {
    title: `${p.who} 该看哪几场 · ${dict.site.name}`,
    description: p.care,
    alternates: {
      languages: { 'zh-CN': `/for/${persona}/`, en: `/en/for/${persona}/` },
    },
  };
}

export default async function PersonaPage({
  params,
}: {
  params: Promise<{ persona: string }>;
}) {
  const { persona } = await params;
  if (!isPersonaSlug(persona)) notFound();

  return (
    <SiteChrome locale="zh">
      <PersonaView persona={persona} locale="zh" />
    </SiteChrome>
  );
}
