'use client';

import type { WorkspaceDto } from '@taskflow/contracts/workspace';
import { useState } from 'react';

import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { useDeleteWorkspace } from '../model/use-delete-workspace';

const CONSEQUENCE =
  'Workspace sẽ biến mất ngay với mọi thành viên và bị xóa vĩnh viễn sau 30 ngày. Trong thời gian này chỉ Chủ sở hữu khôi phục được.';

type Props = Readonly<{ workspace: WorkspaceDto; onDeleted: () => void }>;

/** Vùng nguy hiểm: xóa workspace — gõ lại slug để xác nhận (ADR-047/050). Chỉ OWNER thấy. */
export function DeleteWorkspaceSection({ workspace, onDeleted }: Props) {
  const remove = useDeleteWorkspace(workspace.id);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | undefined>();

  const confirm = async () => {
    try {
      await remove.mutateAsync(typed);
      toast({ title: `Đã xóa ${workspace.name}`, description: 'Có thể khôi phục trong 30 ngày.' });
      onDeleted();
    } catch (cause) {
      if (isApiError(cause, 'RESOURCE_NOT_FOUND')) {
        toast({ title: 'Workspace không còn tồn tại', tone: 'error' });
        return onDeleted();
      }
      const stale = isApiError(cause, 'VALIDATION_ERROR') || isApiError(cause, 'VERSION_CONFLICT');
      if (stale) setTyped('');
      setError(
        stale
          ? 'Slug vừa thay đổi hoặc không khớp. Gõ lại slug ở trên.'
          : serverErrorMessage(cause),
      );
    }
  };

  return (
    <section
      aria-labelledby="danger-zone"
      className="flex flex-col gap-3 rounded-card border border-danger p-4"
    >
      <h2 id="danger-zone" className="text-base font-semibold text-danger">
        Vùng nguy hiểm
      </h2>
      <p className="text-sm">{CONSEQUENCE}</p>
      <Dialog
        trigger={
          <Button variant="danger" className="self-start">
            Xóa workspace
          </Button>
        }
        title={`Xóa ${workspace.name}?`}
        description={CONSEQUENCE}
        onOpenChange={() => {
          setTyped('');
          setError(undefined);
        }}
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Hủy</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={remove.isPending}
              disabled={typed !== workspace.slug}
              onClick={() => void confirm()}
            >
              Xóa workspace
            </Button>
          </>
        }
      >
        <Input
          label={`Gõ "${workspace.slug}" để xác nhận`}
          autoComplete="off"
          value={typed}
          error={error}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Dialog>
    </section>
  );
}
