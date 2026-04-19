import type { ReactNode } from 'react';

import { classNames } from './classNames';

export type SegmentedControlItem<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  items: readonly SegmentedControlItem<T>[];
  onChange: (value: T) => void;
  className?: string;
};

/**
 * Use a segmented control for 2-4 peer views inside the same module.
 * It is appropriate for local content switching such as map/list or photo/audio filters.
 * Do not use it for global navigation, destructive actions, or to surface a primary CTA.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  items,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={classNames('segment-switch', className)} role="group" aria-label={label}>
      {items.map((item) => {
        const isActive = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={isActive}
            disabled={item.disabled}
            className={classNames('segment-switch__button', isActive ? 'is-active' : null)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
