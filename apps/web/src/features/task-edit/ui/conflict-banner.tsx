import type { TaskDto } from '@taskflow/contracts/task';

import { PRIORITY_LABEL } from '@/entities/task';
import { Button } from '@/shared/ui/button';

import type { EditableField } from '../model/rebase';

const FIELD_LABEL: Readonly<Record<EditableField, string>> = {
  title: 'Tiêu đề',
  description: 'Mô tả',
  priority: 'Ưu tiên',
  dueDate: 'Hạn chót',
};

const display = (task: TaskDto, field: EditableField): string => {
  if (field === 'priority') return PRIORITY_LABEL[task.priority];
  return task[field] ?? '(trống)';
};

type Props = Readonly<{
  theirs: TaskDto;
  fields: readonly EditableField[];
  saving: boolean;
  onKeepMine: () => void;
  onDiscardMine: () => void;
}>;

/** Khối vàng khi 409 không tự hòa giải được (frontend.md §4.6, wireframe §1.5). */
export function ConflictBanner({ theirs, fields, saving, onKeepMine, onDiscardMine }: Props) {
  const names = fields.map((f) => `"${FIELD_LABEL[f]}"`).join(', ');
  return (
    <section
      role="alert"
      className="flex flex-col gap-2 rounded-control border-l-4 border-warning bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-sm"
    >
      <p>
        <span aria-hidden="true">⚠ </span>
        {theirs.key} vừa được người khác sửa. Trường {names} của bạn khác bản mới nhất.
      </p>
      <details>
        <summary className="cursor-pointer font-medium">Xem bản mới nhất</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {fields.map((f) => (
            <div key={f} className="contents">
              <dt className="text-text-muted">{FIELD_LABEL[f]}</dt>
              <dd className="whitespace-pre-wrap break-words">{display(theirs, f)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={saving} onClick={onKeepMine}>
          Giữ bản của tôi
        </Button>
        <Button size="sm" variant="secondary" disabled={saving} onClick={onDiscardMine}>
          Bỏ thay đổi của tôi
        </Button>
      </div>
    </section>
  );
}
