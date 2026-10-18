'use client';

import type { CompanyDto } from '@taskflow/contracts/company';
import { PRIVACY_CONTACT_MAX } from '@taskflow/contracts/privacy';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi, companyKeys } from '@/entities/company';
import { privacyKeys } from '@/entities/privacy';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

/**
 * Đầu mối liên hệ về dữ liệu cá nhân (T-075) — in trong thông báo quyền riêng tư; trống ⇒ "quản trị viên của công ty".
 * Chữ tự do (tên, email, số điện thoại), ≤ 200 ký tự. `PATCH /company` theo `expectedVersion` (chung version với tên).
 */
export function PrivacyContactForm({ company }: Readonly<{ company: CompanyDto }>) {
  const saved = company.privacyContact ?? '';
  const [contact, setContact] = useState(saved);
  const save = useMutation({
    mutationFn: () =>
      adminApi.updateCompany({
        privacyContact: contact.trim() || null,
        expectedVersion: company.version,
      }),
    onSuccess: (next, _v, _r, context) => {
      context.client.setQueryData(companyKeys.info(), next);
      void context.client.invalidateQueries({ queryKey: privacyKeys.me() });
      toast({ title: 'Đã lưu đầu mối liên hệ', tone: 'success' });
    },
    onError: (error, _v, _r, context) => {
      if (isApiError(error, 'VERSION_CONFLICT')) {
        void context.client.invalidateQueries({ queryKey: companyKeys.info() });
      }
    },
  });
  const message = isApiError(save.error, 'VERSION_CONFLICT')
    ? 'Vừa có người khác sửa thông tin công ty — đã tải lại bản mới.'
    : save.error
      ? serverErrorMessage(save.error)
      : null;
  return (
    <ClientForm
      aria-label="Đầu mối liên hệ dữ liệu cá nhân"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      className="flex max-w-md flex-col gap-4"
    >
      {message && <Alert>{message}</Alert>}
      <Input
        label="Đầu mối liên hệ dữ liệu cá nhân"
        maxLength={PRIVACY_CONTACT_MAX}
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        hint="Tên, email hoặc số điện thoại — hiện trong thông báo quyền riêng tư. Để trống ⇒ nhân viên liên hệ quản trị viên."
      />
      <Button
        type="submit"
        className="self-start"
        disabled={contact.trim() === saved.trim()}
        loading={save.isPending}
      >
        Lưu
      </Button>
    </ClientForm>
  );
}
