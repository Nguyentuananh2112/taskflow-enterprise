'use client';

import type { MemberDto } from '@taskflow/contracts/workspace';
import { useMutation } from '@tanstack/react-query';

import { memberApi, memberErrorMessage, memberKeys, unassignedNote } from '@/entities/member';
import { WORKSPACE_GONE_MESSAGE, forgetWorkspace, isWorkspaceGone } from '@/entities/workspace';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{
  wsId: string;
  member: MemberDto;
  /** Chính mình ⇒ "Rời" (member:leave); người khác ⇒ "Xóa" (member:remove). */
  isSelf: boolean;
  /** Tự rời thành công, hoặc chính mình đã mất quyền workspace (404 `workspace`) ⇒ về /w. */
  onLeft: () => void;
}>;

/** Xóa thành viên / tự rời, có xác nhận (wireframe §1.6). LAST_OWNER ⇒ toast lỗi từ server. */
export function RemoveMemberButton({ wsId, member, isSelf, onLeft }: Props) {
  const remove = useMutation({
    mutationFn: () => memberApi.remove(wsId, member.userId),
    onSuccess: ({ unassignedTaskCount }, _v, _r, context) => {
      const note = unassignedNote(unassignedTaskCount);
      if (isSelf) {
        forgetWorkspace(context.client, wsId);
        toast({
          title: 'Bạn đã rời workspace',
          ...(note ? { description: note } : {}),
          tone: 'success',
        });
        return onLeft();
      }
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) });
      toast({ title: 'Đã xóa', ...(note ? { description: note } : {}), tone: 'success' });
    },
    onError: (error, _v, _r, context) => {
      if (isWorkspaceGone(error)) {
        forgetWorkspace(context.client, wsId);
        toast({ title: WORKSPACE_GONE_MESSAGE, tone: 'error' });
        return onLeft();
      }
      // Người này có thể đã bị xóa ở tab khác (404 `user`) ⇒ làm mới bảng (G1 W2).
      void context.client.invalidateQueries({ queryKey: memberKeys.all(wsId) });
      toast({ title: memberErrorMessage(error), tone: 'error' });
    },
  });

  const label = isSelf ? 'Rời' : 'Xóa';
  return (
    <Dialog
      trigger={
        <Button variant="ghost" size="sm" aria-label={`${label} ${member.fullName}`}>
          {label}
        </Button>
      }
      title={isSelf ? 'Rời workspace này?' : `Xóa ${member.fullName} khỏi workspace?`}
      description={
        isSelf
          ? 'Bạn sẽ mất quyền truy cập; các task đang giao cho bạn sẽ bị bỏ giao.'
          : `Các task đang giao cho ${member.fullName} sẽ bị bỏ giao.`
      }
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            {label}
          </Button>
        </>
      }
    />
  );
}
