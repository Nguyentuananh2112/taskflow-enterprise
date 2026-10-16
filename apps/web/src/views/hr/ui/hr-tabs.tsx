'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '@/shared/lib/cn';

export type HrTab = Readonly<{ key: string; label: string; render: () => ReactNode }>;

type Props = Readonly<{ tabs: readonly HrTab[]; current: string; onChange: (key: string) => void }>;

/**
 * Tab của trang Nhân sự (WAI-ARIA tabs, kích hoạt tự động): ← → Home End chuyển tab; chỉ tab đang
 * chọn nằm trong thứ tự Tab. Chỉ render panel đang mở (mỗi tab tải dữ liệu riêng khi mở).
 */
export function HrTabs({ tabs, current, onChange }: Props) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.key === current),
  );
  const move = (event: KeyboardEvent) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + last) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onChange(tab.key);
    refs.current[next]?.focus();
  };
  const active = tabs[index];
  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Quản lý nhân sự"
        className="flex gap-1 overflow-x-auto border-b border-border"
        onKeyDown={move}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${tab.key}`}
            aria-selected={i === index}
            aria-controls={`${id}-panel`}
            tabIndex={i === index ? 0 : -1}
            onClick={() => onChange(tab.key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap',
              i === index ? 'border-primary font-medium' : 'border-transparent hover:text-primary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active && (
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${active.key}`}>
          {active.render()}
        </div>
      )}
    </div>
  );
}
