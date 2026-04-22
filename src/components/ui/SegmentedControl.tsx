import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { classNames } from './classNames';

export type SegmentedControlItem<T extends string> = {
  value: T;
  label: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  items: readonly SegmentedControlItem<T>[];
  onChange: (value: T) => void;
  panelIdBase?: string;
  size?: 'md' | 'sm';
  fill?: boolean;
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
  panelIdBase,
  size = 'md',
  fill = false,
  className,
}: SegmentedControlProps<T>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function focusAndSelect(index: number) {
    const item = items[index];

    if (!item || item.disabled) {
      return;
    }

    onChange(item.value);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    event.preventDefault();

    const enabledIndexes = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.disabled)
      .map(({ index }) => index);

    if (enabledIndexes.length === 0) {
      return;
    }

    if (event.key === 'Home') {
      focusAndSelect(enabledIndexes[0]);
      return;
    }

    if (event.key === 'End') {
      focusAndSelect(enabledIndexes[enabledIndexes.length - 1]);
      return;
    }

    const currentEnabledIndex = enabledIndexes.indexOf(currentIndex);
    if (currentEnabledIndex === -1) {
      focusAndSelect(enabledIndexes[0]);
      return;
    }

    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const nextEnabledIndex = (currentEnabledIndex + offset + enabledIndexes.length) % enabledIndexes.length;
    focusAndSelect(enabledIndexes[nextEnabledIndex]);
  }

  return (
    <div
      className={classNames(
        'segment-switch',
        size === 'sm' ? 'segment-switch--sm' : null,
        fill ? 'segment-switch--fill' : null,
        className,
      )}
      role="tablist"
      aria-label={label}
    >
      {items.map((item, index) => {
        const isActive = item.value === value;
        const tabId = panelIdBase ? `${panelIdBase}-tab-${item.value}` : undefined;
        const panelId = panelIdBase ? `${panelIdBase}-panel-${item.value}` : undefined;

        return (
          <button
            key={item.value}
            type="button"
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            id={tabId}
            role="tab"
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            disabled={item.disabled}
            data-state={isActive ? 'active' : 'inactive'}
            className={classNames('segment-switch__button', isActive ? 'is-active' : null)}
          >
            <span className="segment-switch__button-content">
              <span className="segment-switch__label">{item.label}</span>
              {item.count != null ? <span className="segment-switch__count">{item.count}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
