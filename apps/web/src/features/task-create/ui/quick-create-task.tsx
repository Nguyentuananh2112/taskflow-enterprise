'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateTaskBody } from '@taskflow/contracts/task';
import { useForm } from 'react-hook-form';

import type { TaskScope } from '@/entities/task';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { useCreateTask } from '../model/use-create-task';

// Schema form dẫn xuất từ contracts (frontend.md §7.2) — không viết lại luật tiêu đề (R1).
const QuickCreateSchema = CreateTaskBody.pick({ title: true });
const FIELDS = ['title'] as const;

/** "Tạo task" trên toolbar: chỉ cần tiêu đề, task vào cuối cột Cần làm. */
export function QuickCreateTask({ scope }: Readonly<{ scope: TaskScope }>) {
  const create = useCreateTask(scope);
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(QuickCreateSchema),
    defaultValues: { title: '' },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const task = await create.mutateAsync(values);
      reset();
      toast({ title: `Đã tạo ${task.key}`, tone: 'success' });
    } catch (error) {
      applyServerErrors((name, e) => setError(name as 'title' | 'root.server', e), error, {
        fields: FIELDS,
      });
    }
  });

  return (
    <form
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Tạo task mới"
      className="flex items-end gap-2"
    >
      <div className="w-72 max-w-full">
        <Input
          label="Task mới"
          placeholder="Tiêu đề task…"
          autoComplete="off"
          error={errors.title?.message ?? errors.root?.server?.message}
          {...register('title')}
        />
      </div>
      <Button type="submit" loading={isSubmitting} className={errors.title ? 'mb-6' : ''}>
        Tạo task
      </Button>
    </form>
  );
}
