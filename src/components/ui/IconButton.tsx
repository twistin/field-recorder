import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

import { classNames } from './classNames';

type IconButtonOwnProps = {
  label: string;
  className?: string;
  children: ReactNode;
};

type IconButtonAsButton = IconButtonOwnProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type IconButtonAsAnchor = IconButtonOwnProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

export type IconButtonProps = IconButtonAsButton | IconButtonAsAnchor;

export function IconButton(props: IconButtonProps) {
  const { label, className, children, ...rest } = props;
  const classes = classNames('icon-button', className);

  if ('href' in props && props.href) {
    return (
      <a
        aria-label={label}
        title={label}
        className={classes}
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {children}
      </a>
    );
  }

  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <button
      type={buttonProps.type ?? 'button'}
      aria-label={label}
      title={label}
      className={classes}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
