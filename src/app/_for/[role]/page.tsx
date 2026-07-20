import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllSessions } from '@/lib/loader';
import { isRole, ROLES, type Role } from '@/lib/schema';
import { LandingView } from '@/app/_landing/LandingView';
import { SessionGrid } from '@/app/_landing/SessionGrid';
import { ROLE_PRESETS, sessionsForRole } from '@/app/_landing/presets';

/**
 * /for/{role} — 角色落地页（design-spec §4.5 / §6.2）。
 *
 * 全枚举预生成（generateStaticParams 覆盖全部 ROLES）。落地页 = 目录按该角色的预设筛选视图
 * + 一段编辑导语。角色↔视频映射当前无真实标注（roles 全为空）→ 走诚实空态，不编造清单
 * （design-spec §7.1 / §4.1 区块 3 备注）。待建立角色标签后本页自动渲染真实结果。
 */
export function generateStaticParams(): Array<{ role: Role }> {
  return ROLES.map((role) => ({ role }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ role: string }>;
}): Promise<Metadata> {
  const { role } = await params;
  if (!isRole(role)) return { title: '角色 · AI Conference 2026 Compass' };
  const preset = ROLE_PRESETS[role];
  return {
    title: `给${preset.name} · AI Conference 2026 Compass`,
    description: preset.intro,
  };
}

export default async function RoleLandingPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (!isRole(role)) notFound();

  const preset = ROLE_PRESETS[role];
  const sessions = sessionsForRole(getAllSessions(), role);

  return (
    <LandingView
      crumbs={[
        { label: '目录', href: '/catalog/' },
        { label: '角色' },
        { label: preset.name },
      ]}
      kicker="角色落地"
      title={`给${preset.name}`}
      lede={preset.intro}
      metaLine={sessions.length > 0 ? `${sessions.length} 场适配` : '角色标注整理中'}
    >
      <SessionGrid
        sessions={sessions}
        emptyTitle="角色标注还在整理中"
        emptyHint="角色↔场次的映射尚未建立，我们不编造推荐；先按主题或时间预算探索。"
      />
    </LandingView>
  );
}
