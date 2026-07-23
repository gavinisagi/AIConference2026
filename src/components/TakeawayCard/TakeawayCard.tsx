import type { Conference, Topic, VideoStatus } from '@/design/tokens';
import type { Locale } from '@/i18n/locale';
import { getDictionary } from '@/i18n/getDictionary';
import { Card } from '../Card/Card';
import { Chip } from '../Chip/Chip';
import { ConfBadge } from '../ConfBadge/ConfBadge';
import { DurationTag } from '../DurationTag/DurationTag';
import { MetaRow } from '../MetaRow/MetaRow';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from './TakeawayCard.module.css';

export interface TakeawayCardProps {
  /** 榜单序号（首页精选 01–10），可选。 */
  rank?: string;
  conference: Conference;
  status: VideoStatus;
  /** 缺省 zh——仅为已退役页面（src/app/_*）兼容，实际路由一律显式传入。 */
  locale?: Locale;
  /** 观点句：编辑提炼的一句话结论，卡片主角。 */
  quote: string;
  /** 支撑说明：为什么值得看 / 关键上下文（最多 2 行）。 */
  support?: string;
  /** 讲者（保留英文原文，§1.4）。 */
  speaker: string;
  minutes: number;
  topics?: Topic[];
  /** 官方来源深链（带时间戳，新标签打开）。 */
  officialHref?: string;
}

/**
 * TakeawayCard — 观点卡（design-spec §6.1）。
 * 首页精选与详情页复用。结构：序号/来源行 -> 观点句 -> 支撑说明 -> 元信息行 -> 行动。
 * recommended 状态时以 Card 的左强调条呈现全站视觉锚点。
 */
export function TakeawayCard({
  rank,
  conference,
  status,
  locale = 'zh',
  quote,
  support,
  speaker,
  minutes,
  topics = [],
  officialHref,
}: TakeawayCardProps) {
  const dict = getDictionary(locale);
  return (
    <Card interactive recommended={status === 'recommended'}>
      <div className={styles.stack}>
        <div className={styles.sourceRow}>
          {rank && <span className={styles.rank}>{rank}</span>}
          <ConfBadge conference={conference} />
          <StatusBadge status={status} locale={locale} />
        </div>

        <p className={styles.quote}>{quote}</p>

        {support && <p className={styles.support}>{support}</p>}

        <MetaRow
          items={[
            speaker,
            <DurationTag key="dur" minutes={minutes} />,
            ...topics.map((t) => <Chip key={t}>{dict.topics[t]}</Chip>),
          ]}
        />

        <div className={styles.actions}>
          {officialHref && (
            <a
              href={officialHref}
              target="_blank"
              rel="noopener noreferrer"
              className="t-body-s"
            >
              {dict.takeawayCard.watchOfficialClip}
            </a>
          )}
          <span className="t-body-s">{dict.takeawayCard.expandDetail}</span>
        </div>
      </div>
    </Card>
  );
}
