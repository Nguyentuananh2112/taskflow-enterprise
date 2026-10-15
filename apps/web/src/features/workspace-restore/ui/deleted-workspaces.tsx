'use client';

import type { DeletedWorkspaceDto } from '@taskflow/contracts/workspace';

import { useDeletedWorkspaces } from '@/entities/workspace';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import { useRestoreWorkspace } from '../model/use-restore-workspace';

const DAY = 86_400_000;
const daysLeft = (purgeAt: string) =>
  Math.max(0, Math.ceil((Date.parse(purgeAt) - Date.now()) / DAY));

/** Khu "Đã xóa — khôi phục được" ở /w (frontend.md §1.1): chỉ có dữ liệu khi tôi là OWNER; rỗng ⇒ ẩn. */
export function DeletedWorkspaces() {
  const deleted = useDeletedWorkspaces();
  const restore = useRestoreWorkspace();
  if (!deleted.data || deleted.data.length === 0) return null;

  const onRestore = (ws: DeletedWorkspaceDto) =>
    restore.mutate(ws.id, {
      onSuccess: () => toast({ title: `Đã khôi phục ${ws.name}`, tone: 'success' }),
      onError: () => toast({ title: 'Không thể khôi phục workspace này', tone: 'error' }),
    });

  return (
    <details className="rounded-card border border-border p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        Đã xóa — khôi phục được ({deleted.data.length})
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {deleted.data.map((ws) => (
          <li key={ws.id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-medium">{ws.name}</span>
            <span className="text-text-muted">Xóa vĩnh viễn sau {daysLeft(ws.purgeAt)} ngày</span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              aria-label={`Khôi phục ${ws.name}`}
              loading={restore.isPending && restore.variables === ws.id}
              onClick={() => onRestore(ws)}
            >
              Khôi phục
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
