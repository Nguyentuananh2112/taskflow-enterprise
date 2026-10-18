'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useReducer } from 'react';

import { PrivacyNotice, usePrivacy } from '@/entities/privacy';
import { useSession } from '@/entities/session';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

import { privacyLater } from '../model/later';
import { useAckPrivacy } from '../model/use-ack';

/** Màn có dữ liệu cá nhân trong thông báo (§5: lần đầu vào Chấm công / Nghỉ phép / Trò chuyện / Phiếu lương). */
const ROUTES = ['/attendance', '/leave', '/chat', '/payslips'];
const onRoute = (pathname: string) =>
  ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

/**
 * Hộp thoại "lần đầu" (T-075): chưa xác nhận phiên bản hiện hành ⇒ hiện ở các màn trên — KHÔNG ở trang chính (/w có
 * dialog nhắc chấm công). Không chặn việc gấp: "Để sau" / Esc đóng ngay, phiên sau hiện lại tới khi "Tôi đã đọc".
 */
export function PrivacyPrompt() {
  const pathname = usePathname() ?? ''; // ngoài router (test, trang lỗi) ⇒ null
  const userId = useSession().user?.id;
  const active = Boolean(userId) && onRoute(pathname);
  const privacy = usePrivacy(active).data;
  const { ack, outdated } = useAckPrivacy();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  if (!active || !userId || !privacy?.needsAck || privacyLater.has(userId, privacy.version)) {
    return null;
  }
  const later = () => {
    privacyLater.add(userId, privacy.version);
    rerender();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && later()}
      title="Thông báo về xử lý dữ liệu cá nhân"
      className="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={later}>
            Để sau
          </Button>
          <Button loading={ack.isPending} onClick={() => ack.mutate(privacy.version)}>
            Tôi đã đọc
          </Button>
        </>
      }
    >
      {ack.isError && (
        <Alert>
          {outdated
            ? 'Thông báo vừa được cập nhật — hãy đọc lại nội dung mới rồi bấm "Tôi đã đọc".'
            : serverErrorMessage(ack.error)}
        </Alert>
      )}
      <PrivacyNotice companyName={privacy.companyName} contact={privacy.privacyContact} level={3} />
      <Link href="/privacy" className="self-start text-sm underline" onClick={later}>
        Mở trang Quyền riêng tư
      </Link>
    </Dialog>
  );
}
