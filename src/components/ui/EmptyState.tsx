import type { ReactNode } from 'react';

import { classNames } from './classNames';

export type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function EmptyState({
  eyebrow,
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={classNames(
        'dashboard-empty-state',
        compact ? 'dashboard-empty-state--compact' : null,
        className,
      )}
    >
      {icon ? (
        <span className="dashboard-empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="dashboard-empty-state__copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <p className="display-heading dashboard-empty-state__title">{title}</p>
        <p className="module-copy text-sm dashboard-empty-state__description">{description}</p>
      </div>
      {action ? <div className="dashboard-empty-state__action">{action}</div> : null}
    </div>
  );
}
