import type { ReactNode } from 'react';

import { classNames } from './classNames';

export type SummaryStripItem = {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
};

export type SummaryStripProps = {
  items: SummaryStripItem[];
  ariaLabel?: string;
  compact?: boolean;
  className?: string;
};

/**
 * Compact summary for short, comparable operational metrics.
 * Prefer this over multiple equal-weight micro-cards when the user only needs
 * fast numeric scanning and not deep per-metric actions.
 */
export function SummaryStrip({
  items,
  ariaLabel,
  compact = false,
  className,
}: SummaryStripProps) {
  return (
    <ul
      className={classNames('summary-strip', compact ? 'summary-strip--compact' : null, className)}
      aria-label={ariaLabel}
    >
      {items.map((item, index) => (
        <li key={index} className="summary-strip__item">
          <span className="summary-strip__label">{item.label}</span>
          <strong className="summary-strip__value">{item.value}</strong>
          {item.detail ? <span className="summary-strip__detail">{item.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}
