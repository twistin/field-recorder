import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

/**
 * Use `ListRow` for repeated operational items that share the same structure
 * and one dominant action target. If the item needs large media, multiple CTAs,
 * or a lot of bespoke layout, prefer a `preview` card instead.
 */
type ListRowOwnProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  stats?: ReactNode[];
  actionLabel?: ReactNode;
  compact?: boolean;
  className?: string;
};

type ListRowAsButton = ListRowOwnProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ListRowAsAnchor = ListRowOwnProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

type ListRowStatic = ListRowOwnProps & {
  href?: undefined;
  onClick?: undefined;
};

export type ListRowProps = ListRowAsButton | ListRowAsAnchor | ListRowStatic;

/**
 * Scannable row primitive for structured lists.
 * Lists should be preferred over card grids when the user is comparing many similar items.
 */
export function ListRow(props: ListRowProps) {
  const {
    eyebrow,
    title,
    meta,
    stats,
    actionLabel,
    compact = false,
    className,
    ...rest
  } = props;

  const classes = classNames(
    'structured-list-row',
    compact ? 'structured-list-row--compact' : null,
    className,
  );

  const content = (
    <>
      <span className="structured-list-row__main">
        {eyebrow ? <span className="structured-list-row__eyebrow">{eyebrow}</span> : null}
        <strong className="structured-list-row__title">{title}</strong>
        {meta ? <span className="structured-list-row__meta">{meta}</span> : null}
      </span>
      {stats && stats.length > 0 ? (
        <span className="structured-list-row__stats">
          {stats.map((stat, index) => (
            <span key={index} className="structured-list-row__stat">
              {stat}
            </span>
          ))}
        </span>
      ) : null}
      {actionLabel ? <span className="structured-list-row__action">{actionLabel}</span> : null}
    </>
  );

  if ('href' in props && props.href) {
    return (
      <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }

  if ('onClick' in props && typeof props.onClick === 'function') {
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;

    return (
      <button type={buttonProps.type ?? 'button'} className={classes} {...buttonProps}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
