import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

import { classNames } from './classNames';

export type SurfaceTone = 'sky' | 'mint' | 'amber' | 'clay';

export type SurfaceProps<T extends ElementType = 'div'> = {
  as?: T;
  tone?: SurfaceTone;
  primary?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

export function Surface<T extends ElementType = 'div'>({
  as,
  tone,
  primary = false,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Component = (as ?? 'div') as ElementType;

  return (
    <Component
      className={classNames(
        'panel',
        tone ? 'panel-tone' : null,
        tone ? `panel-tone--${tone}` : null,
        primary ? 'panel-primary' : null,
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
