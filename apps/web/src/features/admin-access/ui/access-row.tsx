'use client';

import type { AccessDto, CompanyGrant, CompanyRole } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { EMPLOYEE_STATUS_LABEL, GRANT_LABEL, adminApi, companyKeys } from '@/entities/company';
import { sessionKeys } from '@/entities/session';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Select } from '@/shared/ui/select';
import { toast } from '@/shared/ui/toast';

const ROLES = [
  { value: 'EMPLOYEE', label: 'Nhân viên' },
  { value: 'ADMIN', label: 'Quản trị viên' },
] as const;
const GRANTS: readonly CompanyGrant[] = ['HR_MANAGE', 'PAYROLL_MANAGE'];

function accessError(error: unknown): string {
  const details = isApiError(error) ? (error.details as Record<string, unknown> | null) : null;
  if (details?.reason === 'last_admin') return 'Phải còn ít nhất một Quản trị viên.';
  if (details?.rule === 'GRANT_NOT_ALLOWED')
    return 'Quản trị viên đã có mọi quyền — không cần cấp thêm.';
  if (isApiError(error, 'VERSION_CONFLICT'))
    return 'Vừa có người khác đổi quyền người này — đã tải lại.';
  return serverErrorMessage(error);
}

type Props = Readonly<{ row: AccessDto; viewerId: string | null }>;

/**
 * Một người ở Quản trị › Phân quyền (ADR-134/135): vai trò (Nhân viên / Quản trị viên) + quyền cấp thêm cho nhân viên
 * (Quản lý nhân sự, Kế toán). Lưu theo dòng với `expectedVersion`; Quản trị viên ⇒ không cấp thêm (đã có hết). Đổi
 * chính mình ⇒ làm mới `/auth/me` (menu đổi ngay).
 */
export function AccessRow({ row, viewerId }: Props) {
  const [draft, setDraft] = useState<{ role: CompanyRole; grants: CompanyGrant[] }>({
    role: row.role,
    grants: [...row.grants],
  });
  const dirty =
    draft.role !== row.role ||
    draft.grants.length !== row.grants.length ||
    draft.grants.some((g) => !row.grants.includes(g));
  const save = useMutation({
    mutationFn: () =>
      adminApi.setAccess(row.userId, {
        role: draft.role,
        grants: draft.role === 'ADMIN' ? [] : draft.grants,
        expectedVersion: row.version,
      }),
    onSuccess: (next, _v, _r, context) => {
      context.client.setQueryData<AccessDto[]>(companyKeys.access(), (list) =>
        list?.map((r) => (r.userId === next.userId ? next : r)),
      );
      if (next.userId === viewerId)
        void context.client.invalidateQueries({ queryKey: sessionKeys.me });
      setDraft({ role: next.role, grants: [...next.grants] });
      toast({ title: `Đã lưu quyền của ${row.fullName}`, tone: 'success' });
    },
    onError: (error, _v, _r, context) => {
      if (isApiError(error, 'VERSION_CONFLICT')) {
        void context.client.invalidateQueries({ queryKey: companyKeys.access() });
      }
      toast({ title: accessError(error), tone: 'error' });
    },
  });
  const toggle = (grant: CompanyGrant) =>
    setDraft((d) => ({
      ...d,
      grants: d.grants.includes(grant) ? d.grants.filter((g) => g !== grant) : [...d.grants, grant],
    }));

  return (
    <li
      aria-label={row.fullName}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 md:flex-row md:items-end"
    >
      <div className="min-w-0 md:flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {row.fullName}
          {row.status !== 'ACTIVE' && <Badge>{EMPLOYEE_STATUS_LABEL[row.status]}</Badge>}
          {row.userId === viewerId && <Badge>Bạn</Badge>}
        </p>
        <p className="truncate text-sm text-text-muted">{row.email}</p>
      </div>
      <div className="md:w-44">
        <Select
          label={`Vai trò của ${row.fullName}`}
          hideLabel
          options={ROLES}
          value={draft.role}
          onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as CompanyRole }))}
        />
      </div>
      <fieldset className="flex flex-col gap-2 text-sm" disabled={draft.role === 'ADMIN'}>
        <legend className="sr-only">Quyền cấp thêm của {row.fullName}</legend>
        {GRANTS.map((g) => (
          <label key={g} className="flex min-h-8 items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={draft.role !== 'ADMIN' && draft.grants.includes(g)}
              onChange={() => toggle(g)}
              aria-label={`${GRANT_LABEL[g]} — ${row.fullName}`}
            />
            <span aria-hidden="true">{GRANT_LABEL[g]}</span>
          </label>
        ))}
      </fieldset>
      <Button
        size="sm"
        disabled={!dirty}
        loading={save.isPending}
        aria-label={`Lưu quyền của ${row.fullName}`}
        onClick={() => save.mutate()}
      >
        Lưu
      </Button>
    </li>
  );
}
