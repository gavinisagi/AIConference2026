import type { Metadata } from 'next';
import {
  Button,
  Card,
  Chip,
  ConfBadge,
  DurationTag,
  MetaRow,
  StatusBadge,
  TakeawayCard,
} from '@/components';
import { conferenceMeta, statusMeta, topicMeta } from '@/design/tokens';
import styles from './styleguide.module.css';

export const metadata: Metadata = {
  title: '组件画廊 · Compass Design System',
  description:
    'design-spec §3 设计系统的可视化校验页：主题变量、基础组件与三态徽章一览。',
};

/**
 * 组件画廊（styleguide）—— design-spec §3 设计系统的可视化校验页。
 * 纯静态导出为 out/styleguide/index.html，供 Turing 评审与 T3–T6 取样对照。
 * 覆盖：色板 / 字阶 / 三态徽章 / Card / Chip / Button / DurationTag / 观点卡。
 */
export default function StyleguidePage() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className="t-label" style={{ color: 'var(--accent)' }}>
          Compass Design System
        </p>
        <h1 className="t-display">组件画廊 Styleguide</h1>
        <p className={`t-body-l reading ${styles.lead}`}>
          design-spec §3 设计系统的可视化校验页。所有颜色、字阶、间距均取自{' '}
          <code className={styles.code}>theme.css</code> 的 CSS 变量，组件样式统一走
          CSS Modules。本页用于 Turing 评审与后续页面（T3–T6）取样对照。
        </p>
      </header>

      {/* ---- 色板 ---- */}
      <Section id="palette" title="色板 Palette" hint="§3.2 · 严格 token，不新增未定义色值">
        <div className={styles.swatchGrid}>
          <Swatch name="--paper" value="#FBFAF8" />
          <Swatch name="--surface" value="#FFFFFF" />
          <Swatch name="--surface-sunken" value="#F4F2ED" />
          <Swatch name="--ink" value="#1C1B19" />
          <Swatch name="--ink-secondary" value="#57534E" />
          <Swatch name="--ink-muted" value="#8A857D" />
          <Swatch name="--hairline" value="#E7E4DE" />
          <Swatch name="--hairline-strong" value="#D8D4CC" />
          <Swatch name="--accent" value="#1B3A5B" />
          <Swatch name="--accent-hover" value="#142C46" />
          <Swatch name="--accent-tint" value="#E9EEF4" />
        </div>
      </Section>

      {/* ---- 字阶 ---- */}
      <Section id="type" title="字阶 Typography" hint="§3.3 · 衬线标题 + 无衬线正文 + 等宽 Meta">
        <div className={styles.typeStack}>
          <p className="t-display">Display 展示标题 56/34</p>
          <p className="t-h2">H2 区块标题 · 300 小时 AI 大会视频</p>
          <h3 className="t-h3">H3 卡片标题 · Agent 与 Evals 的工程实践</h3>
          <p className="t-body-l">
            Body L 导语 · 用编辑判断，按你的角色和时间，挑出该看的几条。
          </p>
          <p className="t-body-m">
            Body M 正文 · 中英文混排优先阅读，专有名词如 Agent、Context 保留原文。
          </p>
          <p className="t-body-s">Body S 说明 · 次级说明文本，克制的次级墨色。</p>
          <p className="t-label">Label 标签 · Editorial</p>
          <p className="t-meta">Meta 元信息 · 18 min · 941 sessions</p>
        </div>
      </Section>

      {/* ---- 三态状态徽章 ---- */}
      <Section
        id="status"
        title="状态徽章 Status Badge"
        hint="§3.2 · 三态可区分，recommended 为全站视觉锚点"
      >
        <div className={styles.row}>
          {(['recommended', 'indexed', 'analyzing'] as const).map((s) => (
            <div key={s} className={styles.statusCell}>
              <StatusBadge status={s} />
              <span className="t-meta">{statusMeta[s].label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ---- 大会色标 ---- */}
      <Section id="conf" title="大会色标 Conference Badge" hint="§3.6 · 6px 圆点 + 名称，仅识别">
        <div className={styles.row}>
          {(Object.keys(conferenceMeta) as Array<keyof typeof conferenceMeta>).map(
            (c) => (
              <ConfBadge key={c} conference={c} />
            ),
          )}
        </div>
      </Section>

      {/* ---- 主题 Chip ---- */}
      <Section id="chip" title="主题 Chip" hint="§3.6 · 4px 圆角，accent-tint 底 + accent 字">
        <div className={styles.row}>
          {(Object.keys(topicMeta) as Array<keyof typeof topicMeta>).map((t) => (
            <Chip key={t} href={`/topic/${t}`}>
              {topicMeta[t].label}
            </Chip>
          ))}
        </div>
      </Section>

      {/* ---- 时长标 ---- */}
      <Section id="duration" title="时长标 Duration Tag" hint="§3.6 · 等宽体 + 时钟微图标">
        <div className={styles.row}>
          <DurationTag minutes={8} />
          <DurationTag minutes={18} />
          <DurationTag minutes={45} />
          <DurationTag minutes={62} />
          <DurationTag minutes={125} />
        </div>
      </Section>

      {/* ---- 按钮 ---- */}
      <Section id="button" title="按钮 Button" hint="§3.7 · 主 / 次 / 文字三变体，44px 触控">
        <div className={styles.row}>
          <Button variant="primary">在 X 上关注更新</Button>
          <Button variant="secondary">查看完整目录</Button>
          <Button variant="text">加入候选名单 →</Button>
          <Button variant="primary" disabled>
            禁用态
          </Button>
        </div>
      </Section>

      {/* ---- 元信息行 ---- */}
      <Section id="meta" title="元信息行 Meta Row" hint="§6.1 · 讲者 · 时长 · 主题，中点分隔">
        <MetaRow
          items={[
            '示例讲者',
            <DurationTag key="d" minutes={18} />,
            <Chip key="t1">{topicMeta.agent.label}</Chip>,
            <Chip key="t2">{topicMeta.evals.label}</Chip>,
          ]}
        />
      </Section>

      {/* ---- 基础卡片 ---- */}
      <Section id="card" title="卡片 Card" hint="§3.5 · 8px 圆角，发丝线描边，hover 上浮">
        <div className={styles.cardGrid}>
          <Card>
            <h3 className="t-h3">默认卡</h3>
            <p className="t-body-s">静态卡片，发丝线描边 + 轻阴影。示例内容 · 非真实数据。</p>
          </Card>
          <Card interactive>
            <h3 className="t-h3">交互卡</h3>
            <p className="t-body-s">hover 上移 2px + 阴影加重（150ms）。示例内容 · 非真实数据。</p>
          </Card>
          <Card interactive recommended>
            <h3 className="t-h3">推荐先看卡</h3>
            <p className="t-body-s">左侧 3px 暖金强调条 —— 全站视觉锚点。示例内容 · 非真实数据。</p>
          </Card>
        </div>
      </Section>

      {/* ---- 观点卡 ---- */}
      <Section
        id="takeaway"
        title="观点卡 Takeaway Card"
        hint="§6.1 · 首页精选与详情页复用；recommended 呈现锚点"
      >
        <div className={styles.cardGrid}>
          <TakeawayCard
            rank="01"
            conference="ai-engineer"
            status="recommended"
            quote="把 Evals 当成产品的第一等公民，而不是上线前的补丁。"
            support="示例内容 · 非真实数据。讲者阐述以评测驱动的迭代如何缩短 Agent 的调试周期。"
            speaker="示例讲者"
            minutes={18}
            topics={['evals', 'agent']}
            officialHref="https://example.com/watch"
          />
          <TakeawayCard
            rank="02"
            conference="figma-config"
            status="indexed"
            quote="Design-to-Code 的价值在收敛设计意图，而非替代工程判断。"
            support="示例内容 · 非真实数据。一段关于设计交付与代码生成边界的讨论。"
            speaker="示例讲者"
            minutes={42}
            topics={['design-to-code']}
          />
          <TakeawayCard
            rank="03"
            conference="cursor-compile"
            status="analyzing"
            quote="上下文工程（Context）正在成为 AI 编程体验的胜负手。"
            support="示例内容 · 非真实数据。深度解读整理中，先看官方原片。"
            speaker="示例讲者"
            minutes={125}
            topics={['context', 'ai-coding']}
          />
        </div>
      </Section>

      <footer className={styles.foot}>
        <p className="t-body-s">
          Compass Design System · design-spec §3 · 样式方案：CSS Modules（见
          docs/design-system.md）。示例内容 · 非真实数据。
        </p>
      </footer>
    </main>
  );
}

/** 画廊分节容器：标题 + 一行来源提示 + 内容。 */
function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className="t-h2">{title}</h2>
        <p className="t-meta">{hint}</p>
      </div>
      {children}
    </section>
  );
}

/** 单个色板格：色块 + token 名 + hex。 */
function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className={styles.swatch}>
      <div
        className={styles.swatchChip}
        style={{ background: `var(${name})` }}
        aria-hidden="true"
      />
      <span className="t-meta">{name}</span>
      <span className={`t-meta ${styles.swatchHex}`}>{value}</span>
    </div>
  );
}
