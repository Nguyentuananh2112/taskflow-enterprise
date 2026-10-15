import { MemberRoleChangedEvent, WorkspaceAccessRevokedEvent } from '@taskflow/contracts/realtime';
import type { WorkspaceDto } from '@taskflow/contracts/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { sessionKeys } from '@/entities/session';
import { workspaceKeys } from '@/entities/workspace';
import { useRealtimeClient } from '@/shared/socket';
import { toast } from '@/shared/ui/toast';

const ROLE_LABEL = {
  OWNER: 'Chủ sở hữu',
  PM: 'Quản lý dự án',
  MEMBER: 'Thành viên',
  VIEWER: 'Người xem',
} as const;

/**
 * Sự kiện cấp ứng dụng (frontend.md §3.5): đổi role ⇒ usePermission cập nhật tức thì; mất quyền
 * workspace (bị xóa/rời, hoặc workspace bị xóa mềm) ⇒ xóa cache workspace, về `/w` nếu đang ở trong.
 */
export function useRealtimeSession(): void {
  const client = useRealtimeClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  });

  useEffect(() => {
    const offRole = client.on('member:role-changed', (raw) => {
      const event = MemberRoleChangedEvent.safeParse(raw);
      if (!event.success) return;
      const { workspaceId, role } = event.data.data;
      queryClient.setQueryData<WorkspaceDto>(
        workspaceKeys.detail(workspaceId),
        (old) => old && { ...old, myRole: role },
      );
      void queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      toast({ title: `Vai trò của bạn đã đổi thành ${ROLE_LABEL[role]}` });
    });
    const offRevoked = client.on('workspace:access-revoked', (raw) => {
      const event = WorkspaceAccessRevokedEvent.safeParse(raw);
      if (!event.success) return;
      const { workspaceId } = event.data.data;
      queryClient.removeQueries({ queryKey: workspaceKeys.root(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      if (path.current.startsWith(`/w/${workspaceId}`)) {
        router.replace('/w');
        // Payload không phân biệt bị xóa khỏi workspace hay workspace bị xóa — không đoán.
        toast({ title: 'Bạn không còn truy cập được workspace này' });
      }
    });
    return () => {
      offRole();
      offRevoked();
    };
  }, [client, queryClient, router]);
}
