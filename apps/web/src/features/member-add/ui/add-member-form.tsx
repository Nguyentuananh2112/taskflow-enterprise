'use client';

import type { WorkspaceRole } from '@taskflow/contracts/rbac';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { memberApi, memberKeys, useMemberCandidates } from '@/entities/member';
import { ROLE_LABEL, assignableRoles } from '@/entities/workspace';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { ClientForm } from '@/shared/ui/client-form';
import { Combobox } from '@/shared/ui/combobox';
import { Select } from '@/shared/ui/select';
import { toast } from '@/shared/ui/toast';

function addError(error: unknown): string {
  const d = isApiError(error) ? (error.details as Record<string, unknown> | null) : null;
  if (d?.rule === 'NOT_ACTIVE_MEMBER') {
    return 'Người này không còn làm ở công ty (hoặc đã có lịch nghỉ việc) — không thêm được.';
  }
  if (d?.reason === 'already_member') return 'Người này đã ở workspace này.';
  if (isApiError(error, 'RESOURCE_NOT_FOUND')) return 'Không tìm thấy người này — hãy tìm lại.';
  return serverErrorMessage(error);
}

type Props = Readonly<{ wsId: string; actorRole: WorkspaceRole | null }>;
type Picked = Readonly<{ id: string; label: string }>;

/**
 * Thêm thành viên (PM+; ADR-134): ô tìm NHÂN VIÊN công ty (combobox — gõ ≥ 2 ký tự tên hoặc email, mỗi lựa chọn kèm
 * email để phân biệt người trùng tên), không gõ email tự do. PM chỉ cấp Thành viên / Người xem.
 */
export function AddMemberForm({ wsId, actorRole }: Props) {
  const roles = assignableRoles(actorRole);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [role, setRole] = useState<WorkspaceRole>('MEMBER');
  const term = useDebouncedValue(query.trim(), 300);
  const candidates = useMemberCandidates(wsId, term);
  const add = useMutation({
    mutationFn: () => memberApi.add(wsId, { userId: picked?.id ?? '', role }),
    onSuccess: (member, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) });
      setPicked(null);
      setQuery('');
      toast({ title: `Đã thêm ${member.fullName}`, tone: 'success' });
    },
  });
  const options = (candidates.data ?? []).map((c) => ({
    value: c.id,
    label: `${c.fullName} · ${c.email}`,
  }));

  return (
    <ClientForm
      onSubmit={(event) => {
        event.preventDefault();
        if (picked) add.mutate();
      }}
      aria-label="Thêm thành viên"
      className="flex flex-col gap-3"
    >
      {add.isError && <Alert>{addError(add.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-start">
        <Combobox
          label="Tìm nhân viên"
          options={options}
          selectedLabel={picked?.label ?? ''}
          query={query}
          onQueryChange={(q) => {
            setQuery(q);
            if (picked && q !== picked.label) setPicked(null);
          }}
          onSelect={(id) => {
            const hit = options.find((o) => o.value === id);
            if (hit) setPicked({ id, label: hit.label });
          }}
          loading={candidates.isFetching}
          hint="Gõ ít nhất 2 ký tự tên hoặc email."
          emptyText={
            term.length < 2
              ? 'Gõ ít nhất 2 ký tự.'
              : 'Không có nhân viên phù hợp (hoặc đã ở workspace này).'
          }
        />
        <Select
          label="Vai trò"
          options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          value={role}
          onChange={(e) => setRole(e.target.value as WorkspaceRole)}
        />
        <Button type="submit" disabled={!picked} loading={add.isPending} className="sm:mt-6">
          Thêm
        </Button>
      </div>
    </ClientForm>
  );
}
