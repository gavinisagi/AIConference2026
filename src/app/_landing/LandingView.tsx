import type { ReactNode } from 'react';
import Link from 'next/link';
import { Breadcrumb, type Crumb } from '@/app/_shared/Breadcrumb';
import styles from './landing.module.css';

export interface LandingViewProps {
  /** 面包屑路径段（末项为当前页）。 */
  crumbs: readonly Crumb[];
  /** 小标签（如「角色落地」「时间预算」「主题」）。 */
  kicker: string;
  /** 落地页标题。 */
  title: string;
  /** 编辑导语（一段）。 */
  lede: string;
  /** 可选的等宽计数 / 元信息行。 */
  metaLine?: ReactNode;
  /** 主体（视频卡网格 / 歌单）。 */
  children: ReactNode;
}

/**
 * LandingView — 落地页统一外壳（design-spec §4.5 / §6.2）。
 *
 * 三类落地页（/for /budget /topic）共用：面包屑 + 编辑导语头部 + 主体 + 回目录出口。
 * 「落地页 = 目录的预设筛选视图 + 一段编辑导语」在此定形（design-spec §3.7）。
 */
export function LandingView({ crumbs, kicker, title, lede, metaLine, children }: LandingViewProps) {
  return (
    <main className={styles.page}>
      <div className={styles.inner}>
        <Breadcrumb items={crumbs} />

        <header className={styles.head}>
          <span className={styles.kicker}>{kicker}</span>
          <h1 className={styles.h1}>{title}</h1>
          <p className={styles.lede}>{lede}</p>
          {metaLine && <p className={styles.metaLine}>{metaLine}</p>}
        </header>

        {children}

        <div className={styles.outro}>
          <Link href="/catalog/" className={styles.outroLink}>
            查看完整目录 →
          </Link>
        </div>
      </div>
    </main>
  );
}
