import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllSessions, getConferences, getSiteStats, displayDeepReadStatus } from '@/lib/loader';
import { conferenceMeta } from '@/design/tokens';
import { ROLES, type Role } from '@/lib/schema';
import { CatalogBrowser } from './CatalogBrowser';
import styles from './catalog.module.css';

export const metadata: Metadata = {
  title: '完整目录 · AI Conference 2026 Compass',
  description:
    '941 场 AI 大会 session 的可筛选目录：按大会 / 角色 / 主题 / 时长 / 状态筛选。视频均跳转官方来源观看。',
};

/**
 * /catalog — 视频目录页（design-spec §5 / §8.3）。
 *
 * 服务端（构建期）渲染稳定外壳：页头、概览统计条、来源分布——数值全部取自 T1 真实语料，
 * 不编造。交互主体 CatalogBrowser 为客户端岛（筛选/排序/URL 状态/无限滚动）。
 * 纯静态导出：无后端，数据构建期注入。
 */
export default function CatalogPage() {
  const stats = getSiteStats();
  const conferences = getConferences();
  const sessions = getAllSessions();

  // 概览统计条——单行等宽文本，contiguous 输出保证数值与语料一致（design-spec §5.1）。
  const statline = `已索引 ${stats.totalSessions} 场 · 总时长 ${stats.totalHours} 小时 · 深度解读${displayDeepReadStatus()}`;

  // 各角色真实标注计数（当前语料普遍为 0 → 筛选区据此标注「整理中」，不编造维度）。
  const roleCounts = ROLES.reduce(
    (acc, r) => {
      acc[r] = sessions.reduce((n, s) => (s.roles.includes(r) ? n + 1 : n), 0);
      return acc;
    },
    {} as Record<Role, number>,
  );

  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <nav className={styles.crumb} aria-label="面包屑">
          <Link href="/">首页</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">完整目录</span>
        </nav>

        <header className={styles.head}>
          <h1 className={styles.h1}>完整目录</h1>
          <p className={styles.lede}>
            三场 AI 大会的全部 session，按你的角色、主题与可用时间检索。本站不内嵌播放，
            每条视频均跳转官方来源观看。
          </p>

          {/* 概览统计条（等宽体，报告感）——数值取自真实语料（§5.1）。 */}
          <p className={styles.statline}>{statline}</p>

          {/* 来源分布（极不均，稀疏来源接空态，§5.1 / §7）。 */}
          <p className={styles.dist}>
            来源分布：
            {conferences.map((c, i) => (
              <span key={c.id} className={styles.distItem}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                {conferenceMeta[c.id].label} {c.sessionCount}
              </span>
            ))}
          </p>
        </header>

        <CatalogBrowser sessions={[...sessions]} roleCounts={roleCounts} />
      </div>
    </main>
  );
}
