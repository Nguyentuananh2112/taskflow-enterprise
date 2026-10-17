'use client';

import type { Chip } from '../model/use-uploads';

type Props = Readonly<{ chips: readonly Chip[]; onRemove: (key: string) => void }>;

/** Tệp đang đính kèm: tên (text, không HTML), tiến độ %, lỗi bằng lời thường, nút gỡ (hủy tải dở). */
export function UploadChips({ chips, onRemove }: Props) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Tệp đính kèm" className="flex flex-wrap gap-2">
      {chips.map((chip, i) => (
        <li
          key={chip.key}
          data-testid={`upload-chip-${i}`}
          className="flex max-w-56 items-center gap-2 rounded-control border border-border bg-bg-subtle px-2 py-1 text-xs"
        >
          {chip.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- object URL cục bộ, không tối ưu được
            <img
              src={chip.preview}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded object-cover"
            />
          ) : (
            <span aria-hidden="true">📄</span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{chip.name}</span>
            {chip.error ? (
              <span className="text-danger">{chip.error}</span>
            ) : chip.result ? null : (
              <progress
                aria-label={`Đang tải ${chip.name}`}
                max={1}
                value={chip.progress}
                className="h-1 w-full accent-primary"
              />
            )}
          </span>
          <button
            type="button"
            aria-label={`Bỏ tệp ${chip.name}`}
            onClick={() => onRemove(chip.key)}
            className="rounded px-1 text-text-muted hover:bg-surface"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
