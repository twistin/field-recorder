import type { ReactNode } from 'react';

import { classNames } from './classNames';

/**
 * `default` uses the accent treatment and should be reserved for active/live status.
 * Use `muted` for passive metadata that should stay scannable but quiet.
 * Use explicit semantic variants like `offline` for warning/problem states.
 */
export type BadgeVariant = 'default' | 'muted' | 'offline';

export type BadgeProps = {
  children: ReactNode;
  icon?: ReactNode;
  variant?: BadgeVariant;
  className?: string;
};

/**
 * Small status/metadadata chip.
 * Do not use accent badges for every count or label, or the interface loses hierarchy.
 */
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
