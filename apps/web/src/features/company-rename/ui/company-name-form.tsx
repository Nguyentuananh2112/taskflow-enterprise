'use client';

import type { CompanyDto } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi, companyKeys } from '@/entities/company';
import { sessionKeys } from '@/entities/session';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

/**
 * Tên công ty (ADR-137 Q4 — nhập lúc bootstrap, Admin sửa sau): in ở đầu phiếu lương, trang kích hoạt, header. Lưu theo
 * `expectedVersion`; xong ⇒ làm mới `/auth/me` để header đổi ngay.
 */
export function CompanyNameForm({ company }: Readonly<{ company: CompanyDto }>) {
  const [name, setName] = useState(company.name);
  const save = useMutation({
    mutationFn: () =>
      adminApi.updateCompany({ name: name.trim(), expectedVersion: company.version }),
    onSuccess: (next, _v, _r, context) => {
      context.client.setQueryData(companyKeys.info(), next);
      void context.client.invalidateQueries({ queryKey: sessionKeys.me });
      toast({ title: 'Đã lưu tên công ty', tone: 'success' });
    },
    onError: (error, _v, _r, context) => {
      if (isApiError(error, 'VERSION_CONFLICT')) {
        void context.client.invalidateQueries({ queryKey: companyKeys.info() });
      }
    },
  });
  const message = isApiError(save.error, 'VERSION_CONFLICT')
    ? 'Vừa có người khác đổi tên công ty — đã tải lại tên mới.'
    : save.error
      ? serverErrorMessage(save.error)
      : null;
  return (
    <ClientForm
      aria-label="Thông tin công ty"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="flex max-w-md flex-col gap-4"
    >
      {message && <Alert>{message}</Alert>}
      <Input
        label="Tên công ty"
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        type="submit"
        className="self-start"
        disabled={!name.trim() || name.trim() === company.name}
        loading={save.isPending}
      >
        Lưu
      </Button>
    </ClientForm>
  );
}
