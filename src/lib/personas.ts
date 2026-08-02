/**
 * personas.ts — 首页的四个角色入口。
 *
 * 每个 persona 一对一映射到数据契约里的 Role 枚举（src/lib/schema.ts）——不新造
 * 一套分类，也不做多对多映射：契约里只有这 4 个角色，persona 就是它们面向读者的
 * 说法（"应用层工程师" 之于 developer）。这样角色页的筛选口径与列表页的「谁该看」
 * 完全一致，不会出现"入口说 30 场、进去只剩 12 场"的对不上。
 *
 * 显示文案（who / care）在词典里（picker.personas），此处只定义身份与映射。
 */
import type { Role } from '@/lib/schema';

/** URL 里用的 persona slug（/for/{slug}）。 */
export const PERSONA_SLUGS = ['engineer', 'founder', 'designer', 'trend'] as const;
export type PersonaSlug = (typeof PERSONA_SLUGS)[number];

/** persona slug → 契约角色枚举。 */
export const PERSONA_ROLE: Record<PersonaSlug, Role> = {
  engineer: 'developer',
  founder: 'founder-lead',
  designer: 'product-design',
  trend: 'trend',
};

/** 卡片上的等宽体眉标（各语言通用，故不进词典）。 */
export const PERSONA_KICKER: Record<PersonaSlug, string> = {
  engineer: 'ENGINEER',
  founder: 'FOUNDER',
  designer: 'DESIGNER',
  trend: 'TREND',
};

export function isPersonaSlug(v: string): v is PersonaSlug {
  return (PERSONA_SLUGS as readonly string[]).includes(v);
}
