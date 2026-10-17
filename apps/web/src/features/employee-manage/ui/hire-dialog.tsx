'use client';

import type { ActivationDto } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { companyKeys, employeesApi } from '@/entities/company';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { dmy, employeeErrorMessage, shiftDate } from '../lib/messages';
import { LinkBox } from './link-box';

type Props = Readonly<{
  /** Hôm nay theo SERVER (giờ lịch) — mặc định / giới hạn ngày vào làm. */
  today: string;
  onClose: () => void;
  /** Nhận lại người đã nghỉ: email + tên điền sẵn (ADR-137 — nhiệm kỳ mới, tài khoản cũ). */
  rehire?: Readonly<{ email: string; fullName: string }>;
}>;

/**
 * Thêm nhân viên (`POST hr/employees`): email + họ tên + ngày vào làm (mặc định hôm nay, lùi ≤ 31 ngày). Email mới ⇒
 * hộp link kích hoạt MỘT lần; nhận lại người đã có mật khẩu ⇒ không cần link. Ngày vào trước hôm nay ⇒ cảnh báo
 * những ngày làm đã qua sẽ là vắng (A S3, TL chốt).
 */
export function HireDialog({ today, onClose, rehire }: Props) {
  const [form, setForm] = useState({
    email: rehire?.email ?? '',
    fullName: rehire?.fullName ?? '',
    startDate: today,
  });
  const { email, fullName, startDate } = form;
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  const [link, setLink] = useState<{ fullName: string; activation: ActivationDto } | null>(null);
  const hire = useMutation({
    mutationFn: () =>
      employeesApi.hire({ email: email.trim(), fullName: fullName.trim(), startDate }),
    onSuccess: (r, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: companyKeys.employees() });
      if (r.activation) setLink({ fullName: fullName.trim(), activation: r.activation });
      else {
        toast({
          title: `Đã nhận lại ${fullName.trim()}`,
          description: 'Tài khoản cũ đăng nhập lại được bằng mật khẩu cũ.',
          tone: 'success',
        });
        onClose();
      }
    },
  });
  if (link)
    return <LinkBox fullName={link.fullName} activation={link.activation} onClose={onClose} />;
  const past = startDate < today;
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={rehire ? `Nhận lại ${rehire.fullName}` : 'Thêm nhân viên'}
      description="Nhân viên nhận link kích hoạt để tự đặt mật khẩu. Không gửi mật khẩu qua tin nhắn."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button
            loading={hire.isPending}
            disabled={!email.trim() || !fullName.trim() || !startDate}
            onClick={() => hire.mutate()}
          >
            {rehire ? 'Nhận lại' : 'Thêm'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {hire.isError && <Alert>{employeeErrorMessage(hire.error)}</Alert>}
        <Input
          label="Email"
          type="email"
          autoComplete="off"
          required
          readOnly={rehire !== undefined}
          value={email}
          onChange={set('email')}
        />
        <Input
          label="Họ tên"
          autoComplete="off"
          required
          value={fullName}
          onChange={set('fullName')}
        />
        <Input
          label="Ngày vào làm"
          type="date"
          required
          min={shiftDate(today, -31)}
          max={today}
          value={startDate}
          onChange={set('startDate')}
        />
        {past && (
          <Alert tone="info">
            Những ngày làm việc từ {dmy(startDate)} đến hôm qua sẽ tính là vắng — nhập bù giờ ở Nhân
            sự › Bảng công tháng.
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
