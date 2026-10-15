import { MemberRoleChangedEvent, WorkspaceAccessRevokedEvent } from '@taskflow/contracts/realtime';
import type { WorkspaceDto } from '@taskflow/contracts/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { memberKeys } from '@/entities/member';
import { sessionKeys } from '@/entities/session';
import { ROLE_LABEL, workspaceKeys } from '@/entities/workspace';
import { useRealtimeClient } from '@/shared/socket';
import { toast } from '@/shared/ui/toast';

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
      // Bảng thành viên (T-034) hiển thị role của chính mình ⇒ làm mới.
      void queryClient.invalidateQueries({ queryKey: memberKeys.all(workspaceId) });
      toast({ title: `Vai trò của bạn đã đổi thành ${ROLE_LABEL[role]}` });
    });
    const offRevoked = client.on('workspace:access-revoked', (raw) => {
      const event = WorkspaceAccessRevokedEvent.safeParse(raw);
      if (!event.success) return;
      const { workspaceId } = event.data.data;
      queryClient.removeQueries({ queryKey: workspaceKeys.root(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.list });
      if (path.current.startsWith(`/w/${workspaceId}`)) {
        router.replace('/w');
        // Do chính tab này gây ra (tự rời / xóa workspace) thì màn đó đã báo — không toast lần hai.
        // Payload không phân biệt bị xóa khỏi workspace hay workspace bị xóa — không đoán.
        if (event.data.originClientId !== client.clientId) {
          toast({ title: 'Bạn không còn truy cập được workspace này' });
        }
      }
    });
    return () => {
      offRole();
      offRevoked();
    };
  }, [client, queryClient, router]);
}
