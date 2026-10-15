import { zodResolver } from '@hookform/resolvers/zod';
import type { TaskDto } from '@taskflow/contracts/task';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import type { TaskScope } from '@/entities/task';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { toast } from '@/shared/ui/toast';

import {
  EDITABLE_FIELDS,
  EditConflictError,
  EditTaskSchema,
  diffChanges,
  toFormValues,
  type EditTaskInput,
  type EditTaskOutput,
  type EditableField,
} from './rebase';
import { useUpdateTask } from './use-update-task';

/**
 * State của form sửa task trong drawer. `base` = task lúc form được mount; drawer mount lại form
 * (đổi `key`) khi task đổi mà người dùng KHÔNG đang sửa ⇒ field không dirty luôn hiển thị bản mới
 * nhất; đang sửa ⇒ giữ giá trị người dùng và đánh dấu field người khác vừa đổi (frontend.md §4.6).
 */
export function useEditTaskForm(
  scope: TaskScope,
  task: TaskDto,
  /** `version` của `base` khi đang sửa / đang hòa giải, `null` khi form sạch. */
  onEditingChange: (baseVersion: number | null) => void,
) {
  const [base] = useState(task);
  const [conflict, setConflict] = useState<EditConflictError | null>(null);
  const update = useUpdateTask(scope, base.id);
  const form = useForm<EditTaskInput, unknown, EditTaskOutput>({
    resolver: zodResolver(EditTaskSchema),
    defaultValues: toFormValues(base),
  });
  const editing = form.formState.isDirty || conflict !== null;
  useEffect(() => {
    onEditingChange(editing ? base.version : null);
  }, [editing, base.version, onEditingChange]);

  const submitAgainst = (target: TaskDto) =>
    form.handleSubmit(async (values) => {
      const changes = diffChanges(base, values);
      if (Object.keys(changes).length === 0) return;
      try {
        await update.mutateAsync({ base: target, changes });
        setConflict(null);
        form.reset(form.getValues());
        toast({ title: `Đã lưu ${base.key}`, tone: 'success' });
      } catch (error) {
        if (error instanceof EditConflictError) return setConflict(error);
        applyServerErrors(
          (name, e) => form.setError(name as EditableField | 'root.server', e),
          error,
          { fields: EDITABLE_FIELDS },
        );
      }
    });

  return {
    form,
    conflict,
    saving: update.isPending,
    save: submitAgainst(base),
    /** Ghi đè có chủ đích bằng version mới nhất. */
    keepMine: () => (conflict ? void submitAgainst(conflict.theirs)() : undefined),
    /** Bỏ thay đổi ⇒ form sạch ⇒ drawer mount lại với bản mới nhất. */
    discardMine: () => {
      setConflict(null);
      form.reset();
    },
    /** Người khác vừa đổi field này kể từ khi mình bắt đầu sửa. */
    changedRemotely: (field: EditableField) => task[field] !== base[field],
  };
}
