'use client';

import { WorkspaceRole } from '@taskflow/contracts/rbac';
import type { MemberDto } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { memberApi, memberErrorMessage, memberKeys, unassignedNote } from '@/entities/member';
import {
  ROLE_LABEL,
  WORKSPACE_GONE_MESSAGE,
  forgetWorkspace,
  isWorkspaceGone,
} from '@/entities/workspace';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Select } from '@/shared/ui/select';
import { toast } from '@/shared/ui/toast';

const OPTIONS = WorkspaceRole.options.map((role) => ({ value: role, label: ROLE_LABEL[role] }));

type Props = Readonly<{
  wsId: string;
  member: MemberDto;
  isSelf?: boolean;
  /** Chính mình đã mất quyền workspace (404 `workspace`, G1 W1) ⇒ về /w. */
  onLeft: () => void;
}>;

/**
 * Đổi role (chỉ OWNER render ô này). Hạ xuống Người xem ⇒ xác nhận trước vì các task đang giao
 * bị bỏ giao (ADR-044). Tự hạ mình khỏi Chủ sở hữu cũng xác nhận (mất quyền ngay, không tự lấy lại được
 * — B F8). OWNER cuối cùng: FE không tự đếm (danh sách phân trang) — server trả LAST_OWNER.
 */
export function RoleSelect({ wsId, member, isSelf = false, onLeft }: Props) {
  const [pending, setPending] = useState<WorkspaceRole | null>(null);
  const change = useMutation({
    mutationFn: (role: WorkspaceRole) => memberApi.changeRole(wsId, member.userId, role),
    onSettled: (_data, error, _role, _result, context) => {
      if (isWorkspaceGone(error)) return forgetWorkspace(context.client, wsId);
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) });
    },
  });

  const send = (role: WorkspaceRole) =>
    change.mutate(role, {
      onSuccess: ({ unassignedTaskCount }) => {
        const note = unassignedNote(unassignedTaskCount);
        toast({ title: 'Đã đổi vai trò', ...(note ? { description: note } : {}), tone: 'success' });
      },
      onError: (error) => {
        const gone = isWorkspaceGone(error);
        toast({ title: gone ? WORKSPACE_GONE_MESSAGE : memberErrorMessage(error), tone: 'error' });
        if (gone) onLeft();
      },
      onSettled: () => setPending(null),
    });

  return (
    <>
      <Select
        label={`Vai trò của ${member.fullName}`}
        hideLabel
        className="w-40 min-w-36"
        options={OPTIONS}
        value={member.role}
        disabled={change.isPending}
        onChange={(event) => {
          const role = WorkspaceRole.parse(event.target.value);
          if (role === member.role) return;
          if (role === 'VIEWER' || (isSelf && member.role === 'OWNER')) setPending(role);
          else send(role);
        }}
      />
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          isSelf
            ? `Đổi vai trò của bạn thành ${pending ? ROLE_LABEL[pending] : ''}?`
            : `Hạ ${member.fullName} xuống Người xem?`
        }
        description={confirmText(member, isSelf, pending)}
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

function confirmText(member: MemberDto, isSelf: boolean, role: WorkspaceRole | null) {
  const unassign = role === 'VIEWER' ? ' Các task đang giao sẽ bị bỏ giao.' : '';
  if (isSelf) {
    return `Bạn sẽ mất quyền Chủ sở hữu ngay và không tự lấy lại được.${unassign}`;
  }
  return `Người xem không được giao việc — các task đang giao cho ${member.fullName} sẽ bị bỏ giao.`;
}
