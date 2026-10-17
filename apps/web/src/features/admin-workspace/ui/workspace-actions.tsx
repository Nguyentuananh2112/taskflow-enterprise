'use client';

import { useMutation, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { adminApi, companyKeys } from '@/entities/company';
import type { AdminWorkspaceWithMembersDto as AdminWorkspaceDto } from '@/shared/api/pending-contracts/company';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Select } from '@/shared/ui/select';
import { toast } from '@/shared/ui/toast';

function workspaceError(error: unknown): string {
  const d = isApiError(error) ? (error.details as Record<string, unknown> | null) : null;
  if (d?.rule === 'NOT_WORKSPACE_MEMBER')
    return 'Người này không ở workspace đó — chọn một thành viên còn lại.';
  if (d?.reason === 'workspace_has_owner') return 'Workspace đã có chủ sở hữu.';
  if (d?.reason === 'workspace_has_members')
    return 'Workspace còn thành viên — giao chủ sở hữu thay vì lưu trữ.';
  if (d?.reason === 'workspace_deleted') return 'Workspace đã bị xóa.';
  return serverErrorMessage(error);
}

type Props = Readonly<{ workspace: AdminWorkspaceDto }>;

/**
 * Việc của Admin với workspace mồ côi (ADR-134): còn thành viên ⇒ "Giao chủ sở hữu" (Admin không tự vào workspace
 * mình không ở); không còn ai ⇒ "Lưu trữ". Workspace còn chủ / đã xóa / đã lưu trữ ⇒ không có nút.
 */
export function WorkspaceActions({ workspace: ws }: Props) {
  // Người nhận = thành viên CÒN LẠI của workspace mồ côi (TL chốt) — Admin không tự vào ws mình không ở.
  const candidates = (ws.members ?? []).map((m) => ({ value: m.userId, label: m.fullName }));
  const [open, setOpen] = useState<'assign' | 'archive' | null>(null);
  const [userId, setUserId] = useState('');
  const apply = (client: QueryClient, next: AdminWorkspaceDto, title: string) => {
    client.setQueryData<AdminWorkspaceDto[]>(companyKeys.workspaces(), (list) =>
      list?.map((w) => (w.id === next.id ? next : w)),
    );
    setOpen(null);
    toast({ title, tone: 'success' });
  };
  const assign = useMutation({
    mutationFn: () => adminApi.assignOwner(ws.id, userId),
    onSuccess: (next, _v, _r, context) =>
      apply(context.client, next, `Đã giao chủ sở hữu ${ws.name}`),
  });
  const archive = useMutation({
    mutationFn: () => adminApi.archive(ws.id),
    onSuccess: (next, _v, _r, context) => apply(context.client, next, `Đã lưu trữ ${ws.name}`),
  });
  if (!ws.orphan || ws.deletedAt || ws.archivedAt) return null;

  return (
    <>
      {ws.memberCount > 0 ? (
        <Button
          size="sm"
          aria-label={`Giao chủ sở hữu cho ${ws.name}`}
          onClick={() => setOpen('assign')}
        >
          Giao chủ sở hữu
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          aria-label={`Lưu trữ ${ws.name}`}
          onClick={() => setOpen('archive')}
        >
          Lưu trữ
        </Button>
      )}
      {open === 'assign' && (
        <Dialog
          open
          onOpenChange={(next) => !next && setOpen(null)}
          title={`Giao chủ sở hữu — ${ws.name}`}
          description="Chọn một thành viên còn lại của workspace này làm chủ sở hữu mới."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Hủy
              </Button>
              <Button disabled={!userId} loading={assign.isPending} onClick={() => assign.mutate()}>
                Giao
              </Button>
            </>
          }
        >
          {assign.isError && <Alert className="mb-3">{workspaceError(assign.error)}</Alert>}
          <Select
            label="Người nhận"
            placeholder="Chọn người…"
            options={candidates}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </Dialog>
      )}
      {open === 'archive' && (
        <Dialog
          open
          onOpenChange={(next) => !next && setOpen(null)}
          title={`Lưu trữ ${ws.name}?`}
          description="Workspace không còn ai. Lưu trữ để ẩn khỏi danh sách; dữ liệu dự án vẫn giữ."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Hủy
              </Button>
              <Button loading={archive.isPending} onClick={() => archive.mutate()}>
                Lưu trữ
              </Button>
            </>
          }
        >
          {archive.isError && <Alert>{workspaceError(archive.error)}</Alert>}
        </Dialog>
      )}
    </>
  );
}
