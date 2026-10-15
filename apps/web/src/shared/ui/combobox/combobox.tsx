'use client';

import { useId, useState, type KeyboardEvent } from 'react';

import { cn } from '@/shared/lib/cn';
import { controlClass } from '@/shared/ui/input';

// Combobox có tìm kiếm theo mẫu ARIA APG "combobox with listbox popup": ô nhập role=combobox,
// aria-activedescendant trỏ tới option đang chọn; ↑/↓ di chuyển, Enter chọn, Esc đóng. Danh sách do
// phía gọi lọc (tìm phía server qua `onQueryChange`) — component chỉ hiển thị.

export type ComboboxOption = Readonly<{ value: string; label: string; description?: string }>;

type Props = Readonly<{
  label: string;
  options: readonly ComboboxOption[];
  /** Nhãn của giá trị đang chọn (hiện khi đóng). */
  selectedLabel: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  hint?: string | undefined;
  emptyText?: string;
}>;

export function Combobox(props: Props) {
  const { label, options, selectedLabel, query, onQueryChange, onSelect, disabled } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const hintId = props.hint ? `${id}-hint` : undefined;

  const choose = (i: number) => {
    const option = options[i];
    if (!option) return;
    onSelect(option.value);
    setOpen(false);
    onQueryChange('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length === 0 ? 0 : (i + step + options.length) % options.length));
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={hintId}
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={open ? 'Gõ để tìm…' : undefined}
        value={open ? query : selectedLabel}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setOpen(true);
          setActive(0);
          onQueryChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        className={cn(controlClass, 'h-10 border-border')}
      />
      {props.hint && (
        <p id={hintId} className="text-xs text-text-muted">
          {props.hint}
        </p>
      )}
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute top-full z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-control border border-border bg-surface p-1 shadow-raised"
      >
        {options.map((option, i) => (
          <li
            key={option.value}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // mousedown (không phải click): giữ focus ở ô nhập, tránh onBlur đóng danh sách trước khi chọn.
            onMouseDown={(event) => {
              event.preventDefault();
              choose(i);
            }}
            className={cn(
              'cursor-pointer rounded-control px-2 py-1.5 text-sm',
              i === active && 'bg-bg-subtle',
            )}
          >
            {option.label}
            {option.description && (
              <span className="ml-2 text-xs text-text-muted">{option.description}</span>
            )}
          </li>
        ))}
        {options.length === 0 && (
          <li role="presentation" className="px-2 py-1.5 text-sm text-text-muted">
            {props.loading ? 'Đang tìm…' : (props.emptyText ?? 'Không có kết quả')}
          </li>
        )}
      </ul>
    </div>
  );
}
