'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import { AddMemberBody } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { memberApi, memberKeys } from '@/entities/member';
import { ROLE_LABEL, assignableRoles } from '@/entities/workspace';
import { isApiError } from '@/shared/api';
import { applyServerErrors } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { toast } from '@/shared/ui/toast';

const FIELDS = ['email', 'role'] as const;
/** security.md §6.5: email chưa có tài khoản ⇒ thông báo chung, không xác nhận email tồn tại hay không. */
const NOT_ADDABLE = 'Không thể thêm người này. Kiểm tra email đã đăng ký tài khoản TaskFlow chưa.';

type Props = Readonly<{ wsId: string; actorRole: WorkspaceRole | null }>;

/** Thêm thành viên theo email (PM+). PM chỉ thấy Thành viên / Người xem trong danh sách role. */
export function AddMemberForm({ wsId, actorRole }: Props) {
  const roles = assignableRoles(actorRole);
  const add = useMutation({
    mutationFn: (body: AddMemberBody) => memberApi.add(wsId, body),
    onSuccess: (_member, _body, _result, context) =>
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) }),
  });
  const { register, handleSubmit, setError, reset, formState } = useForm({
    resolver: zodResolver(AddMemberBody),
    defaultValues: { email: '', role: 'MEMBER' as const },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const member = await add.mutateAsync(values);
      reset({ email: '', role: values.role });
      toast({ title: `Đã thêm ${member.fullName}`, tone: 'success' });
    } catch (error) {
      if (isApiError(error, 'RESOURCE_NOT_FOUND'))
        return setError('root.server', { message: NOT_ADDABLE });
      if (isApiError(error, 'RESOURCE_CONFLICT')) {
        return setError('email', { message: 'Người này đã là thành viên.' });
      }
      applyServerErrors((name, e) => setError(name as (typeof FIELDS)[number], e), error, {
        fields: FIELDS,
      });
    }
  });

  return (
    <ClientForm
      onSubmit={(event) => void onSubmit(event)}
      aria-label="Thêm thành viên"
      className="flex flex-col gap-3"
    >
      {errors.root?.server && <Alert>{errors.root.server.message}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
        <Input
          label="Email"
          type="email"
          autoComplete="off"
          error={errors.email?.message}
          {...register('email')}
        />
        <Select
          label="Vai trò"
          options={roles.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
          error={errors.role?.message}
          {...register('role')}
        />
        <Button type="submit" loading={isSubmitting} className="sm:mt-6">
          Thêm
        </Button>
      </div>
    </ClientForm>
  );
}
