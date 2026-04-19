import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

import { classNames } from './classNames';

export type SurfaceTone = 'sky' | 'mint' | 'amber' | 'clay';
export type SurfaceLevel = 'container' | 'panel' | 'card' | 'overlay';
export type SurfaceEmphasis = 'hero' | 'panel' | 'preview' | 'passive';
export type SurfaceBorder = 'subtle' | 'default' | 'strong';

export type SurfaceProps<T extends ElementType = 'div'> = {
  as?: T;
  tone?: SurfaceTone;
  level?: SurfaceLevel;
  emphasis?: SurfaceEmphasis;
  border?: SurfaceBorder;
  primary?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

export function Surface<T extends ElementType = 'div'>({
  as,
  tone,
  level = 'panel',
  emphasis,
  border,
  primary = false,
  className,
  children,
  ...rest
}: SurfaceProps<T>) {
  const Component = (as ?? 'div') as ElementType;
  const resolvedEmphasis = emphasis ?? (primary ? 'hero' : 'panel');

  return (
    <Component
      className={classNames(
        'panel',
        'surface',
        `surface-level--${level}`,
        `surface-emphasis--${resolvedEmphasis}`,
        border ? `surface-border--${border}` : null,
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
