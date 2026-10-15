'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ProjectDescription, ProjectName, type ProjectDto } from '@taskflow/contracts/project';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { projectApi, projectKeys } from '@/entities/project';
import { isApiError } from '@/shared/api';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

const FormSchema = z.object({ name: ProjectName, description: ProjectDescription });
const FIELDS = ['name', 'description'] as const;

type Props = Readonly<{ project: ProjectDto; canEdit: boolean }>;

/** Tên + mô tả (PM+). keyPrefix chỉ hiển thị (bất biến). Project lưu trữ ⇒ chỉ đọc. */
export function ProjectGeneralForm({ project, canEdit }: Props) {
  const editable = canEdit && !project.isArchived;
  const update = useMutation({
    mutationFn: (body: z.output<typeof FormSchema>) =>
      projectApi.update(project.workspaceId, project.id, body),
    onSuccess: (saved, _body, _result, context) => {
      context.client.setQueryData(projectKeys.detail(project.workspaceId, project.id), saved);
      void context.client.invalidateQueries({ queryKey: projectKeys.all(project.workspaceId) });
    },
  });
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: project.name, description: project.description ?? '' },
  });
  const { errors, isSubmitting, isDirty } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      reset({ name: saved.name, description: saved.description ?? '' });
      toast({ title: 'Đã lưu dự án', tone: 'success' });
    } catch (error) {
      if (isApiError(error, 'PROJECT_ARCHIVED')) {
        return setError('root.server', { message: 'Dự án đã lưu trữ — khôi phục trước khi sửa.' });
      }
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
      });
    }
  });

  return (
    <ClientForm
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Thông tin dự án"
      className="flex flex-col gap-4"
    >
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Tên dự án"
        required
        readOnly={!editable}
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="Mã dự án"
        value={project.keyPrefix}
        readOnly
        hint="Không đổi được sau khi tạo."
      />
      <Textarea
        label="Mô tả"
        rows={4}
        readOnly={!editable}
        error={errors.description?.message}
        {...register('description')}
      />
      {editable && (
        <Button type="submit" loading={isSubmitting} disabled={!isDirty} className="self-start">
          Lưu thay đổi
        </Button>
      )}
    </ClientForm>
  );
}
