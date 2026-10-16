'use client';

import type { ProjectDto } from '@taskflow/contracts/project';
import { useMutation } from '@tanstack/react-query';

import { projectApi, projectKeys } from '@/entities/project';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

/** Lưu trữ (board chỉ đọc — ADR-023/045) / khôi phục. Idempotent ở server. PM+. */
export function ArchiveProjectButton({ project }: Readonly<{ project: ProjectDto }>) {
  const { workspaceId: wsId, id } = project;
  const toggle = useMutation({
    mutationFn: (archived: boolean) => projectApi.setArchived(wsId, id, archived),
    onSuccess: (saved, _v, _r, context) => {
      context.client.setQueryData(projectKeys.detail(wsId, id), saved);
      void context.client.invalidateQueries({ queryKey: projectKeys.all(wsId) });
      toast({
        title: saved.isArchived ? 'Đã lưu trữ dự án' : 'Đã khôi phục dự án',
        tone: 'success',
      });
    },
    onError: (_error, _v, _r, context) => {
      // Trạng thái hiển thị có thể đã cũ (G1 W3) ⇒ đọc lại.
      void context.client.invalidateQueries({ queryKey: projectKeys.detail(wsId, id) });
      toast({ title: 'Không thực hiện được. Vui lòng thử lại.', tone: 'error' });
    },
  });

  if (project.isArchived) {
    return (
      <Button variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate(false)}>
        Khôi phục dự án
      </Button>
    );
  }
  return (
    <Dialog
      trigger={<Button variant="secondary">Lưu trữ dự án</Button>}
      title={`Lưu trữ ${project.name}?`}
      description="Board chuyển sang chỉ đọc: không tạo, sửa, di chuyển hay xóa task. Có thể khôi phục bất cứ lúc nào."
      footer={
        <>
          <DialogClose>
            <Button variant="secondary">Hủy</Button>
          </DialogClose>
          <Button loading={toggle.isPending} onClick={() => toggle.mutate(true)}>
            Lưu trữ
          </Button>
        </>
      }
    />
  );
}
