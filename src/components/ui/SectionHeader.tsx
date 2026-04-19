import type { ReactNode } from 'react';

import { classNames } from './classNames';

type SectionHeadingTag = 'h2' | 'h3' | 'h4';

export type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  titleId?: string;
  descriptionId?: string;
  titleAs?: SectionHeadingTag;
  compact?: boolean;
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
  titleId,
  descriptionId,
  titleAs = 'h2',
  compact = false,
  className,
}: SectionHeaderProps) {
  const TitleTag = titleAs;

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
      {action ? <div className="dashboard-section-header__action">{action}</div> : null}
    </header>
  );
}
