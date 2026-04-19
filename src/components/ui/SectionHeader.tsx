import type { ReactNode } from 'react';

import { Button, type ButtonVariant } from './Button';
import { classNames } from './classNames';

type SectionHeadingTag = 'h2' | 'h3' | 'h4';
type SectionActionVariant = Extract<ButtonVariant, 'secondary' | 'ghost'>;

export type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  actionHref?: string;
  actionVariant?: SectionActionVariant;
  actionAriaLabel?: string;
  titleId?: string;
  descriptionId?: string;
  titleAs?: SectionHeadingTag;
  compact?: boolean;
  className?: string;
};

/**
 * Standard section header for dashboard modules.
 * A section action should stay secondary or ghost and should represent one section-level task
 * such as "view all", "open library", or "see archive". Do not place the main CTA here.
 */
export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  actionLabel,
  onAction,
  actionHref,
  actionVariant = 'ghost',
  actionAriaLabel,
  titleId,
  descriptionId,
  titleAs = 'h2',
  compact = false,
  className,
}: SectionHeaderProps) {
  const TitleTag = titleAs;
  const resolvedAction =
    action ??
    (actionLabel ? (
      actionHref ? (
        <Button
          href={actionHref}
          variant={actionVariant}
          className="section-header-action"
          aria-label={actionAriaLabel}
        >
          {actionLabel}
        </Button>
      ) : onAction ? (
        <Button
          onClick={onAction}
          variant={actionVariant}
          className="section-header-action"
          aria-label={actionAriaLabel}
        >
          {actionLabel}
        </Button>
      ) : null
    ) : null);

  return (
    <header
      className={classNames(
        'dashboard-section-header',
        compact ? 'dashboard-section-header--compact' : null,
        className,
      )}
    >
      <div className="dashboard-section-header__copy">
        {eyebrow ? <p className="eyebrow dashboard-section-header__eyebrow">{eyebrow}</p> : null}
        <TitleTag id={titleId} className="display-heading dashboard-section-header__title">
          {title}
        </TitleTag>
        {description ? (
          <p id={descriptionId} className="dashboard-section-header__description">
            {description}
          </p>
        ) : null}
      </div>
      {resolvedAction ? <div className="dashboard-section-header__action">{resolvedAction}</div> : null}
    </header>
  );
}
