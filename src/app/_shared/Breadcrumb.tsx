import Link from 'next/link';
import styles from './Breadcrumb.module.css';

export interface Crumb {
  label: string;
  /** 有 href 则为可点链接；末项（当前页）不传，渲染为 aria-current。 */
  href?: string;
}

export interface BreadcrumbProps {
  /** 自左向右的路径段。末项为当前页（design-spec §4.4：`目录 / {主题|角色} / 当前`）。 */
  items: readonly Crumb[];
  /** nav 的 aria-label，按语言传入（dict.breadcrumb.ariaLabel）；缺省中文。 */
  ariaLabel?: string;
}

/**
 * Breadcrumb — 面包屑（design-spec §4.4 / §6.2 / §8.4）。
 *
 * 详情页与落地页共用：`目录 / {主题|角色} / 当前`。等宽体、克制。
 * 末项以 aria-current="page" 标注，不作链接；中间段可点回退到上一层。
 */
export function Breadcrumb({ items, ariaLabel = '面包屑' }: BreadcrumbProps) {
  return (
    <nav className={styles.crumb} aria-label={ariaLabel}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className={styles.seg}>
            {i > 0 && (
              <span className={styles.sep} aria-hidden="true">
                {' / '}
              </span>
            )}
            {item.href && !last ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current={last ? 'page' : undefined}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
