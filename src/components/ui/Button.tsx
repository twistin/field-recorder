import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

/**
 * `primary` is reserved for the single next-best action in the current view.
 * In practice that means one prominent primary CTA, usually inside a `hero` card.
 * Use `secondary` and `ghost` for supporting actions so the view keeps a clear action hierarchy.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type ButtonOwnProps = {
  variant?: ButtonVariant;
  className?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children: ReactNode;
};

type ButtonAsButton = ButtonOwnProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ButtonAsAnchor = ButtonOwnProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

export type ButtonProps = ButtonAsButton | ButtonAsAnchor;

/**
 * Shared action primitive for buttons and links.
 * Prefer explicit verb + object labels. Avoid multiple `primary` buttons in the same viewport.
 */
export function Button(props: ButtonProps) {
  const {
    variant = 'secondary',
    className,
    leadingIcon,
    trailingIcon,
    children,
    ...rest
  } = props;

  const classes = classNames('ui-button', `ui-button-${variant}`, className);
  const content = (
    <>
      {leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </>
  );

  if ('href' in props && props.href) {
    return (
      <a className={classes} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {content}
      </a>
    );
  }

  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <button type={buttonProps.type ?? 'button'} className={classes} {...buttonProps}>
      {content}
    </button>
  );
}
