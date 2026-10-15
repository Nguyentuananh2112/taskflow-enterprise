'use client';

import { WorkspaceRole } from '@taskflow/contracts/rbac';
import type { MemberDto } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { memberApi, memberErrorMessage, memberKeys, unassignedNote } from '@/entities/member';
import { ROLE_LABEL } from '@/entities/workspace';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Select } from '@/shared/ui/select';
import { toast } from '@/shared/ui/toast';

const OPTIONS = WorkspaceRole.options.map((role) => ({ value: role, label: ROLE_LABEL[role] }));

type Props = Readonly<{ wsId: string; member: MemberDto }>;

/**
 * Đổi role (chỉ OWNER render ô này). Hạ xuống Người xem ⇒ xác nhận trước vì các task đang giao
 * bị bỏ giao (ADR-044). OWNER cuối cùng: FE không tự đếm (danh sách phân trang) — server trả LAST_OWNER.
 */
export function RoleSelect({ wsId, member }: Props) {
  const [pending, setPending] = useState<WorkspaceRole | null>(null);
  const change = useMutation({
    mutationFn: (role: WorkspaceRole) => memberApi.changeRole(wsId, member.userId, role),
    onSettled: (_data, _error, _role, _result, context) =>
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) }),
  });

  const send = (role: WorkspaceRole) =>
    change.mutate(role, {
      onSuccess: ({ unassignedTaskCount }) => {
        const note = unassignedNote(unassignedTaskCount);
        toast({ title: 'Đã đổi vai trò', ...(note ? { description: note } : {}), tone: 'success' });
      },
      onError: (error) => toast({ title: memberErrorMessage(error), tone: 'error' }),
      onSettled: () => setPending(null),
    });

  return (
    <>
      <Select
        label={`Vai trò của ${member.fullName}`}
        hideLabel
        className="w-40"
        options={OPTIONS}
        value={member.role}
        disabled={change.isPending}
        onChange={(event) => {
          const role = WorkspaceRole.parse(event.target.value);
          if (role === member.role) return;
          if (role === 'VIEWER') setPending(role);
          else send(role);
        }}
      />
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Hạ ${member.fullName} xuống Người xem?`}
        description={`Người xem không được giao việc — các task đang giao cho ${member.fullName} sẽ bị bỏ giao.`}
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Hủy</Button>
            </DialogClose>
            <Button loading={change.isPending} onClick={() => pending && send(pending)}>
              Đổi vai trò
            </Button>
          </>
        }
      />
    </>
  );
}
