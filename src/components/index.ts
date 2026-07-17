/**
 * 基础组件 barrel 导出。design-spec §3 设计系统。
 * 页面统一从 `@/components` 取用组件，隐藏各组件的目录结构。
 */
export { Button } from './Button/Button';
export type { ButtonProps, ButtonVariant } from './Button/Button';

export { Card } from './Card/Card';
export type { CardProps } from './Card/Card';

export { Chip } from './Chip/Chip';
export type { ChipProps } from './Chip/Chip';

export { StatusBadge } from './StatusBadge/StatusBadge';
export type { StatusBadgeProps } from './StatusBadge/StatusBadge';

export { ConfBadge } from './ConfBadge/ConfBadge';
export type { ConfBadgeProps } from './ConfBadge/ConfBadge';

export { DurationTag, formatDuration } from './DurationTag/DurationTag';
export type { DurationTagProps } from './DurationTag/DurationTag';

export { MetaRow } from './MetaRow/MetaRow';
export type { MetaRowProps } from './MetaRow/MetaRow';

export { TakeawayCard } from './TakeawayCard/TakeawayCard';
export type { TakeawayCardProps } from './TakeawayCard/TakeawayCard';

export { TourView } from './Tour/TourView';
