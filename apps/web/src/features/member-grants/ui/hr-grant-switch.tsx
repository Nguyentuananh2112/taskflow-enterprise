'use client';

import type { MemberDto } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { memberApi, memberKeys } from '@/entities/member';
import { forgetWorkspace, isWorkspaceGone } from '@/entities/workspace';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

import { grantErrorMessage } from '../model/grant-errors';

type Props = Readonly<{ wsId: string; member: MemberDto }>;

/**
 * Công tắc "Quản lý nhân sự" (`HR_MANAGE` — ADR-119) trong bảng thành viên; chỉ OWNER render ô này
 * (`hr:grant`). OWNER luôn có quyền (không lưu grant — B-M2) ⇒ hiện "Luôn có"; VIEWER không được cấp.
 * Cấp quyền mở dữ liệu nhạy cảm (IP, lý do nghỉ — §9) ⇒ hỏi lại trước khi cấp; thu thì làm ngay.
 */
export function HrGrantSwitch({ wsId, member }: Props) {
  const [confirming, setConfirming] = useState(false);
  const on = member.grants.includes('HR_MANAGE');
  const save = useMutation({
    mutationFn: (next: boolean) =>
      memberApi.setGrants(
        wsId,
        member.userId,
        next ? [...member.grants, 'HR_MANAGE'] : member.grants.filter((g) => g !== 'HR_MANAGE'),
      ),
    onSuccess: (_dto, next) =>
      toast({
        title: next
          ? `${member.fullName} đã có quyền Quản lý nhân sự`
          : `Đã thu quyền Quản lý nhân sự của ${member.fullName}`,
        tone: 'success',
      }),
    onError: (error) => toast({ title: grantErrorMessage(error), tone: 'error' }),
    onSettled: (_data, error, _next, _result, context) => {
      setConfirming(false);
      if (isWorkspaceGone(error)) return forgetWorkspace(context.client, wsId);
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) });
    },
  });

  if (member.role === 'OWNER') return <span className="text-sm text-text-muted">Luôn có</span>;
  if (member.role === 'VIEWER')
    return <span className="text-sm text-text-muted">Không áp dụng</span>;
  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Quản lý nhân sự: ${member.fullName}`}
        disabled={save.isPending}
        onClick={() => (on ? save.mutate(false) : setConfirming(true))}
        className="inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border bg-bg-subtle p-0.5 transition-colors aria-checked:border-primary aria-checked:bg-primary disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-4 rounded-full transition-transform',
            on ? 'translate-x-5 bg-primary-fg' : 'bg-text-muted',
          )}
        />
      </button>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Cấp quyền Quản lý nhân sự cho ${member.fullName}?`}
        description="Người này sẽ xem bảng công, IP/thiết bị chấm công và lý do nghỉ của mọi nhân viên, duyệt đơn nghỉ, sửa lịch làm việc và số ngày phép."
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Hủy</Button>
            </DialogClose>
            <Button loading={save.isPending} onClick={() => save.mutate(true)}>
              Cấp quyền
            </Button>
          </>
        }
      />
    </>
  );
}
