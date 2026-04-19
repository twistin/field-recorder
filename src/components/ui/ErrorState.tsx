import type { ReactNode } from 'react';

import { classNames } from './classNames';

export type ErrorStateProps = {
  eyebrow?: string;
  title?: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function ErrorState({
  eyebrow = 'Aviso',
  title = 'Hay un problema',
  description,
  icon,
  action,
  compact = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={classNames('error-state', compact ? 'error-state--compact' : null, className)}
    >
      <div className="error-state__header">
        <span className="error-state__icon" aria-hidden="true">
          {icon ?? '!'}
        </span>
        <div className="error-state__copy">
          <p className="eyebrow error-state__eyebrow">{eyebrow}</p>
          <p className="display-heading error-state__title">{title}</p>
          <p className="module-copy text-sm error-state__description">{description}</p>
        </div>
      </div>
      {action ? <div className="error-state__action">{action}</div> : null}
    </div>
  );
}
