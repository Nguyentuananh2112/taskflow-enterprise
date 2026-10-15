'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { WorkspaceName, WorkspaceSlug, type WorkspaceDto } from '@taskflow/contracts/workspace';
import { useForm } from 'react-hook-form';
import * as z from 'zod';

import { SLUG_TAKEN } from '@/entities/workspace';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { useUpdateWorkspace } from '../model/use-update-workspace';

const FormSchema = z.object({ name: WorkspaceName, slug: WorkspaceSlug });
const FIELDS = ['name', 'slug'] as const;

type Props = Readonly<{ workspace: WorkspaceDto; canEdit: boolean }>;

/** Tên + slug (R19: FE KHÔNG tự lowercase — chữ hoa báo lỗi như server). Chỉ OWNER sửa được. */
export function WorkspaceGeneralForm({ workspace, canEdit }: Props) {
  const update = useUpdateWorkspace(workspace.id);
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: { name: workspace.name, slug: workspace.slug },
  });
  const { errors, isSubmitting, isDirty, dirtyFields } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync({
        ...(dirtyFields.name ? { name: values.name } : {}),
        ...(dirtyFields.slug ? { slug: values.slug } : {}),
      });
      reset({ name: saved.name, slug: saved.slug });
      toast({ title: 'Đã lưu workspace', tone: 'success' });
    } catch (error) {
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
        conflictMessages: { slug: SLUG_TAKEN },
      });
    }
  });

  return (
    <ClientForm
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Thông tin workspace"
      className="flex flex-col gap-4"
    >
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <Input
        label="Tên workspace"
        required
        readOnly={!canEdit}
        error={errors.name?.message}
        {...register('name')}
      />
      <Input
        label="Slug"
        required
        readOnly={!canEdit}
        hint="Chữ thường, số và gạch nối, 3–50 ký tự."
        error={errors.slug?.message}
        {...register('slug')}
      />
      {canEdit && (
        <Button type="submit" loading={isSubmitting} disabled={!isDirty} className="self-start">
          Lưu thay đổi
        </Button>
      )}
    </ClientForm>
  );
}
