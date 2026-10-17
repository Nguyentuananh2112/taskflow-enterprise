'use client';

import type { ActivationDto } from '@taskflow/contracts/company';
import { useState } from 'react';

import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';

import { dmy } from '../lib/messages';

type Props = Readonly<{
  /** Người nhận link — để HR biết đang gửi cho ai. */
  fullName: string;
  activation: ActivationDto;
  onClose: () => void;
}>;

/**
 * Hộp link kích hoạt — CHỈ HIỆN MỘT LẦN (ADR-137: không có route đọc lại; token không vào URL / log / thông báo). HR
 * sao chép hoặc chia sẻ (Zalo, Messenger… qua `navigator.share` trên điện thoại). Đóng khi chưa sao chép ⇒ hỏi lại.
 */
export function LinkBox({ fullName, activation, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const until = dmy(activation.expiresAt.slice(0, 10));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(activation.link);
      setCopied(true);
      toast({ title: 'Đã sao chép link', tone: 'success' });
    } catch {
      toast({ title: 'Không sao chép được — hãy chọn ô link rồi sao chép tay.', tone: 'error' });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Kích hoạt tài khoản TaskFlow', url: activation.link });
      setCopied(true);
    } catch {
      // Người dùng hủy chia sẻ — không làm gì.
    }
  };
  const close = () => (copied || confirming ? onClose() : setConfirming(true));

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && close()}
      title={`Link kích hoạt cho ${fullName}`}
      description={`Gửi link này cho ${fullName} để họ tự đặt mật khẩu. Dùng được một lần, tới hết ngày ${until}.`}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {confirming && !copied ? 'Vẫn đóng' : 'Xong'}
          </Button>
          {canShare && (
            <Button variant="secondary" onClick={() => void share()}>
              Chia sẻ
            </Button>
          )}
          <Button onClick={() => void copy()}>{copied ? 'Sao chép lại' : 'Sao chép link'}</Button>
        </>
      }
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Link</span>
        <input
          readOnly
          value={activation.link}
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 w-full rounded-control border border-border bg-bg-subtle px-3 font-mono text-xs"
        />
      </label>
      <Alert tone={confirming && !copied ? 'danger' : 'info'} className="mt-3">
        {confirming && !copied
          ? 'Bạn chưa sao chép link. Đóng hộp này sẽ không xem lại được — khi cần, bấm "Tạo lại link".'
          : 'Link chỉ hiện MỘT lần ở đây. Mất link thì bấm "Tạo lại link" (link cũ hết hiệu lực ngay).'}
      </Alert>
    </Dialog>
  );
}
