import type { ElementType } from 'react';

import { classNames } from './classNames';
import {
  Surface,
  type SurfaceBorder,
  type SurfaceEmphasis,
  type SurfaceLevel,
  type SurfaceProps,
} from './Surface';

/**
 * Card taxonomy for the product:
 * - `hero`: one dominant card per view, owns the main CTA and current status
 * - `panel`: core operational modules
 * - `preview`: browse/search/inspection modules with lower emphasis
 * - `state`: empty, info, or error blocks that should not compete with work areas
 */
export type CardVariant = 'hero' | 'panel' | 'preview' | 'state';

const CARD_VARIANTS: Record<
  CardVariant,
  {
    level: SurfaceLevel;
    emphasis: SurfaceEmphasis;
    border: SurfaceBorder;
    primary: boolean;
  }
> = {
  hero: {
    level: 'panel',
    emphasis: 'hero',
    border: 'strong',
    primary: true,
  },
  panel: {
    level: 'panel',
    emphasis: 'panel',
    border: 'default',
    primary: false,
  },
  preview: {
    level: 'panel',
    emphasis: 'preview',
    border: 'subtle',
    primary: false,
  },
  state: {
    level: 'container',
    emphasis: 'passive',
    border: 'subtle',
    primary: false,
  },
};

export type CardProps<T extends ElementType = 'div'> = {
  variant?: CardVariant;
} & SurfaceProps<T>;

/**
 * Semantic card wrapper over `Surface`.
 * Prefer `variant` first and only override level/emphasis/border when a module
 * has a defensible reason to break the default taxonomy.
 */
export function Card<T extends ElementType = 'div'>({
  variant = 'panel',
  level,
  emphasis,
  border,
  primary,
  className,
  ...rest
}: CardProps<T>) {
  const defaults = CARD_VARIANTS[variant];

  return (
    <Surface
      level={level ?? defaults.level}
      emphasis={emphasis ?? defaults.emphasis}
      border={border ?? defaults.border}
      primary={primary ?? defaults.primary}
      className={classNames('card', `card--${variant}`, className)}
      {...rest}
    />
  );
}
