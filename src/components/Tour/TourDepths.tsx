'use client';

/**
 * TourDepths — 单场页的「三档阅读深度」外壳。
 *
 * 一场 40 分钟演讲有三种读者：只想知道结论的、愿意读完导览的、准备去跳看原片的。
 * 改版前把三者的内容一路铺下来，谁都得滚过不属于自己的部分。现在分三档 tab，
 * 顶部常驻分段时间轴（无论在哪档都能一眼看到必看段落落在哪）。
 *
 * 面板内容由服务端渲染好后作为 ReactNode 传入——React 元素可以跨服务端→客户端
 * 边界，函数不行；这样词典插值、renderRich 等仍留在服务端，本组件只管切换。
 */
import { useState, type ReactNode } from 'react';
import styles from './TourDepths.module.css';

export type DepthKey = 'tldr' | 'read' | 'watch';

export interface DepthTab {
  key: DepthKey;
  label: string;
  hint: string;
}

/** 分段时间轴的一格（纯数据，供点击跳转与配色）。 */
export interface BarSegment {
  /** 占比（flex-grow 权重）。 */
  pct: number;
  /** 起点 mm:ss，宽度够时显示。 */
  start: string;
  /** 悬停标题：「mm:ss–mm:ss 小标题」。 */
  title: string;
  /** 官方原片深链。 */
  href: string;
  mode: 'watch' | 'skim' | 'listen';
}

export function TourDepths({
  tabs,
  segments,
  legendMustWatch,
  legendRest,
  barAriaLabel,
  tabsAriaLabel,
  panels,
}: {
  tabs: readonly DepthTab[];
  segments: readonly BarSegment[];
  legendMustWatch: string;
  legendRest: string;
  barAriaLabel: string;
  tabsAriaLabel: string;
  panels: Record<DepthKey, ReactNode>;
}) {
  // 默认停在「读完」——它是本站的主要交付物（既不像 TL;DR 那样信息太薄，
  // 也不要求读者已经决定去看原片）。
  const [active, setActive] = useState<DepthKey>('read');

  return (
    <div className={styles.wrap}>
      <div className={styles.sticky}>
        <div className={styles.tabRow}>
          <div className={styles.tabs} role="tablist" aria-label={tabsAriaLabel}>
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active === t.key}
                onClick={() => setActive(t.key)}
                className={active === t.key ? styles.tabActive : styles.tab}
              >
                <span className={styles.tabLabel}>{t.label}</span>
                <span className={styles.tabHint}>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {segments.length > 0 && (
          <>
            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <i className={styles.swatchWatch} />
                {legendMustWatch}
              </span>
              <span className={styles.legendItem}>
                <i className={styles.swatchSkim} />
                {legendRest}
              </span>
            </div>
            <div className={styles.bar} role="group" aria-label={barAriaLabel}>
              {segments.map((s, i) => (
                <a
                  key={i}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={s.title}
                  className={styles[`seg_${s.mode}`]}
                  style={{ flexGrow: s.pct }}
                >
                  <span className={styles.segStart}>{s.start}</span>
                </a>
              ))}
            </div>
          </>
        )}
      </div>

      <div className={styles.panel} role="tabpanel">
        {panels[active]}
      </div>
    </div>
  );
}
