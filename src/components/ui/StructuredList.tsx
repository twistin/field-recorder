import type { HTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

export type StructuredListProps = {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLUListElement>;

/**
 * Shared framed list container for repeated operational rows.
 * Use it when items are primarily compared and opened, not browsed as distinct cards.
 */
export function StructuredList({
  children,
  className,
  ...rest
}: StructuredListProps) {
  return (
    <ul className={classNames('structured-list', 'structured-list-panel', className)} {...rest}>
      {children}
    </ul>
  );
}
