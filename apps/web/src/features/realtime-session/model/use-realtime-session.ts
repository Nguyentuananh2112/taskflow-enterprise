import {
  CompanyAccessChangedEventEnvelope,
  MemberRoleChangedEvent,
  NotificationNewEvent,
  WorkspaceAccessRevokedEvent,
} from '@taskflow/contracts/realtime';
import type { NotificationType } from '@taskflow/contracts/hr';
import type { WorkspaceDto } from '@taskflow/contracts/workspace';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { attendanceKeys } from '@/entities/attendance';
import { hrKeys } from '@/entities/hr';
import { leaveKeys } from '@/entities/leave';
import { memberKeys } from '@/entities/member';
import { notificationKeys } from '@/entities/notification';
import { invalidateAvatarViews, sessionKeys } from '@/entities/session';
import { USER_AVATAR_CHANGED, UserAvatarChangedEvent } from '@/shared/api/pending-contracts/avatar';
import {
  ROLE_LABEL,
  WORKSPACE_GONE_MESSAGE,
  forgetWorkspace,
  workspaceKeys,
} from '@/entities/workspace';
import { useRealtimeClient } from '@/shared/socket';
import { toast } from '@/shared/ui/toast';

/** Thông báo gửi HR (đơn mới / người gửi hủy) ⇒ hàng đợi + số phép trên /hr. */
const HR_SIDE: ReadonlySet<NotificationType> = new Set(['LEAVE_SUBMITTED', 'LEAVE_CANCELLED']);
/** Thông báo gửi nhân viên (đơn của mình được xử lý, HR sửa chấm công) ⇒ /leave, thẻ, lịch tháng. */
const EMPLOYEE_SIDE: ReadonlySet<NotificationType> = new Set([
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'LEAVE_REVOKED',
  'LEAVE_CANCELLED',
  'ATTENDANCE_ADJUSTED',
]);

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
      // Picker /w hiển thị role theo workspace (B F9).
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.list });
      toast({ title: `Vai trò của bạn đã đổi thành ${ROLE_LABEL[role]}` });
    });
    const offRevoked = client.on('workspace:access-revoked', (raw) => {
      const event = WorkspaceAccessRevokedEvent.safeParse(raw);
      if (!event.success) return;
      const { workspaceId } = event.data.data;
      forgetWorkspace(queryClient, workspaceId);
      if (path.current.startsWith(`/w/${workspaceId}`)) {
        router.replace('/w');
        // Do chính tab này gây ra (tự rời / xóa workspace) thì màn đó đã báo — không toast lần hai.
        // Payload không phân biệt bị xóa khỏi workspace hay workspace bị xóa — không đoán.
        if (event.data.originClientId !== client.clientId) {
          toast({ title: WORKSPACE_GONE_MESSAGE });
        }
      }
    });
    // ADR-135: vai trò / quyền CÔNG TY đổi ⇒ tải lại `/auth/me` (menu, trang chính đổi ngay — E2E-HR-18). Mất quyền ⇒
    // xóa NGAY dữ liệu đã cache của quyền đó (IP/UA, lý do nghỉ, lương — §9, R27), ở mọi trang.
    const offAccess = client.on('company:access-changed', (raw) => {
      const event = CompanyAccessChangedEventEnvelope.safeParse(raw);
      if (!event.success) return;
      const { role, grants } = event.data.data;
      const admin = role === 'ADMIN';
      const hr = admin || grants.includes('HR_MANAGE');
      if (!hr) queryClient.removeQueries({ queryKey: hrKeys.all() });
      if (!admin) queryClient.removeQueries({ queryKey: ['company', 'admin'] });
      if (!admin && !grants.includes('PAYROLL_MANAGE')) {
        queryClient.removeQueries({ queryKey: ['company', 'payroll'] });
      }
      void queryClient.invalidateQueries({ queryKey: sessionKeys.me });
      toast({ title: 'Quyền của bạn trong công ty vừa thay đổi' });
    });
    // ADR-123: thông báo bền đã ghi ở server ⇒ chỉ cần tải lại chuông (số + danh sách).
    const offNotification = client.on('notification:new', (raw) => {
      const event = NotificationNewEvent.safeParse(raw);
      if (!event.success) return;
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
      // T-041c: dữ liệu liên quan đổi theo thông báo, không cần tải lại trang (E2E-HR-02). Mốc 3.5: dữ liệu HR
      // thuộc công ty (key ['company', …]) ⇒ chỉ query đang mở mới refetch.
      const { type } = event.data.data;
      if (HR_SIDE.has(type)) {
        void queryClient.invalidateQueries({ queryKey: hrKeys.all() });
      }
      if (EMPLOYEE_SIDE.has(type)) {
        void queryClient.invalidateQueries({ queryKey: leaveKeys.all() });
        void queryClient.invalidateQueries({ queryKey: attendanceKeys.all() });
      }
    });
    // ADR-142: ai đó (kể cả mình ở tab khác) đổi / gỡ avatar ⇒ làm mới mọi chỗ hiện avatar (URL ký mới, `/auth/me`
    // có avatarUrlLarge). TẠM: event chưa có trong ServerToClientEvents (G thêm ở T-068) ⇒ đăng ký qua chữ ký lỏng.
    const onLoose = client.on.bind(client) as unknown as (
      event: string,
      handler: (raw: unknown) => void,
    ) => () => void;
    const offAvatar = onLoose(USER_AVATAR_CHANGED, (raw) => {
      const event = UserAvatarChangedEvent.safeParse(raw);
      if (!event.success) return;
      void invalidateAvatarViews(queryClient, event.data.data.userId).catch(() => undefined);
    });
    // Rớt socket thì có thể lỡ `notification:new` ⇒ kết nối lại thì tải lại chuông.
    const offReconnect = client.onReconnect(
      () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
    );
    return () => {
      offRole();
      offRevoked();
      offAccess();
      offNotification();
      offAvatar();
      offReconnect();
    };
  }, [client, queryClient, router]);
}
