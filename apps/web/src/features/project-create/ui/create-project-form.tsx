'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateProjectBody, type ProjectDto } from '@taskflow/contracts/project';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { projectApi, projectKeys } from '@/entities/project';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

const FIELDS = ['name', 'keyPrefix', 'description'] as const;

type Props = Readonly<{ wsId: string; onCreated: (project: ProjectDto) => void }>;

/** Tạo project (PM+). keyPrefix bất biến sau khi tạo, unique trong workspace (R17). */
export function CreateProjectForm({ wsId, onCreated }: Props) {
  const create = useMutation({
    mutationFn: (body: CreateProjectBody) => projectApi.create(wsId, body),
    onSuccess: (project, _body, _result, context) => {
      context.client.setQueryData(projectKeys.detail(wsId, project.id), project);
      void context.client.invalidateQueries({ queryKey: projectKeys.all(wsId) });
    },
  });
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(CreateProjectBody),
    defaultValues: { name: '', keyPrefix: '', description: '' },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      onCreated(await create.mutateAsync(values));
    } catch (error) {
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
        conflictMessages: { keyPrefix: 'Mã này đã được dùng trong workspace.' },
      });
    }
  });

  return (
    <ClientForm
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Tạo dự án"
      className="flex flex-col gap-4"
    >
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Tên dự án"
        required
        autoComplete="off"
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="Mã dự án"
        required
        autoComplete="off"
        hint="2–10 ký tự IN HOA hoặc số, bắt đầu bằng chữ (vd WEB). Không đổi được sau khi tạo."
        error={errors.keyPrefix?.message}
        {...register('keyPrefix')}
      />
      <Textarea
        label="Mô tả"
        rows={3}
        error={errors.description?.message}
        {...register('description')}
      />
      <Button type="submit" loading={isSubmitting} className="self-start">
        Tạo dự án
      </Button>
    </ClientForm>
  );
}
