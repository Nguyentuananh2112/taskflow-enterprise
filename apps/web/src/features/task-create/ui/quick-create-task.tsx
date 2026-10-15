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
      className="flex w-full items-end gap-2 sm:w-auto"
    >
      {/* 360px: ô nhập co theo chỗ còn lại (không tràn ngang); từ sm cố định 18rem (E3). */}
      <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
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
