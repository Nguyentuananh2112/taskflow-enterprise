'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CreateWorkspaceBody, type WorkspaceDto } from '@taskflow/contracts/workspace';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { SLUG_TAKEN } from '@/entities/workspace';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';

import { useCreateWorkspace } from '../model/use-create-workspace';

// Ô slug để trống ⇒ không gửi (server tự sinh). Luật lấy từ contracts, KHÔNG tự lowercase (R19).
const FormSchema = CreateWorkspaceBody.extend({
  slug: z.union([z.literal('').transform(() => undefined), CreateWorkspaceBody.shape.slug]),
});
const FIELDS = ['name', 'slug'] as const;

export function CreateWorkspaceForm({
  onCreated,
}: Readonly<{ onCreated: (ws: WorkspaceDto) => void }>) {
  const create = useCreateWorkspace();
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: '', slug: '' },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      onCreated(await create.mutateAsync(values.slug ? values : { name: values.name }));
    } catch (error) {
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
        conflictMessages: { slug: SLUG_TAKEN },
      });
    }
  });

  return (
    <ClientForm onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Tên workspace"
        required
        autoComplete="off"
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="Slug (tùy chọn)"
        hint="Chữ thường, số và gạch nối, 3–50 ký tự. Để trống để hệ thống tự tạo."
        autoComplete="off"
        error={errors.slug?.message}
        {...register('slug')}
      />
      <Button type="submit" loading={isSubmitting} className="self-start">
        Tạo workspace
      </Button>
    </ClientForm>
  );
}
