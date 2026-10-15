'use client';

import type { TaskDto } from '@taskflow/contracts/task';

import { PRIORITY_LABEL, type TaskScope } from '@/entities/task';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

import type { EditableField } from '../model/rebase';
import { useEditTaskForm } from '../model/use-edit-task-form';
import { ConflictBanner } from './conflict-banner';

const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }));
const REMOTE_HINT = '• Vừa được người khác thay đổi';

type Props = Readonly<{
  scope: TaskScope;
  /** Bản mới nhất trong cache (để đánh dấu field người khác vừa đổi). */
  task: TaskDto;
  onEditingChange: (baseVersion: number | null) => void;
}>;

/** Sửa tiêu đề, mô tả, ưu tiên, hạn chót (MEMBER+, project chưa lưu trữ). */
export function EditTaskForm({ scope, task, onEditingChange }: Props) {
  const edit = useEditTaskForm(scope, task, onEditingChange);
  const { register, formState } = edit.form;
  const { errors, isDirty } = formState;
  const hint = (field: EditableField) =>
    isDirty && edit.changedRemotely(field) ? REMOTE_HINT : undefined;

  return (
    <form
      noValidate
      aria-label="Sửa task"
      onSubmit={(event) => void edit.save(event)}
      className="flex flex-col gap-4"
    >
      {edit.conflict && (
        <ConflictBanner
          theirs={edit.conflict.theirs}
          fields={edit.conflict.fields}
          saving={edit.saving}
          onKeepMine={edit.keepMine}
          onDiscardMine={edit.discardMine}
        />
      )}
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Tiêu đề"
        required
        autoComplete="off"
        error={errors.title?.message}
        hint={hint('title')}
        {...register('title')}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Ưu tiên"
          options={PRIORITY_OPTIONS}
          error={errors.priority?.message}
          hint={hint('priority')}
          {...register('priority')}
        />
        <Input
          label="Hạn chót"
          type="date"
          error={errors.dueDate?.message}
          hint={hint('dueDate')}
          {...register('dueDate')}
        />
      </div>
      <Textarea
        label="Mô tả"
        error={errors.description?.message}
        hint={hint('description')}
        {...register('description')}
      />
      <div className="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={!isDirty || edit.saving}
          onClick={() => edit.form.reset()}
        >
          Hủy
        </Button>
        <Button type="submit" loading={edit.saving} disabled={!isDirty}>
          Lưu thay đổi
        </Button>
      </div>
    </form>
  );
}
