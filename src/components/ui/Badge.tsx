import type { ReactNode } from 'react';

import { classNames } from './classNames';

export type BadgeVariant = 'default' | 'muted' | 'offline';

export type BadgeProps = {
  children: ReactNode;
  icon?: ReactNode;
  variant?: BadgeVariant;
  className?: string;
};

export function Badge({
  children,
  icon,
  variant = 'default',
  className,
}: BadgeProps) {
  return (
    <span
      className={classNames(
        'telemetry-chip',
        variant === 'muted' ? 'telemetry-chip--muted' : null,
        variant === 'offline' ? 'telemetry-chip--offline' : null,
        className,
      )}
    >
      {icon}
      <span>{children}</span>
    </span>
  );
}
