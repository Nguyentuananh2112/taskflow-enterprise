'use client';

import type { ActivationDto } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { companyKeys, employeesApi } from '@/entities/company';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

import { dmy, shiftDate } from '../lib/messages';
import { profileChanges, profileErrorMessage, type ProfileForm } from '../lib/profile-form';
import { ProfileFields } from './profile-fields';

export type Rehire = Readonly<{ userId: string; email: string; fullName: string }>;

type Props = Readonly<{
  today: string;
  rehire?: Rehire;
  /** Hồ sơ đang có (nhận lại) hoặc rỗng (người mới) — chỉ gửi trường đã đổi. */
  before: ProfileForm;
  onClose: () => void;
  onLink: (link: { fullName: string; activation: ActivationDto }) => void;
}>;

/**
 * Email + họ tên + ngày vào làm (nhiệm kỳ: mặc định hôm nay, lùi ≤ 31 ngày — cảnh báo ngày đã qua là vắng) + hồ sơ
 * (không bắt buộc). Nhận lại người có ngày vào cũ: "Giữ ngày vào cũ" (thâm niên tính tiếp) / "Ngày vào mới".
 */
export function HireForm({ today, rehire, before, onClose, onLink }: Props) {
  const [form, setForm] = useState({
    email: rehire?.email ?? '',
    fullName: rehire?.fullName ?? '',
    startDate: today,
  });
  const [profile, setProfile] = useState(before);
  const oldHireDate = rehire ? before.hireDate : '';
  const [keep, setKeep] = useState(oldHireDate !== '');
  const { email, fullName, startDate } = form;
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  const hire = useMutation({
    mutationFn: () => {
      const { hireDate, ...rest } = profileChanges(profile, before);
      const dates = !oldHireDate
        ? hireDate
          ? { hireDate }
          : {}
        : keep
          ? { keepHireDate: true }
          : { keepHireDate: false, hireDate: profile.hireDate };
      return employeesApi.hire({
        email: email.trim(),
        fullName: fullName.trim(),
        startDate,
        ...rest,
        ...dates,
      });
    },
    onSuccess: (r, _v, _r, context) => {
      void context.client.invalidateQueries({ queryKey: companyKeys.employees() });
      if (r.activation) onLink({ fullName: fullName.trim(), activation: r.activation });
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
  return (
    <div className="flex flex-col gap-3">
      {hire.isError && <Alert>{profileErrorMessage(hire.error)}</Alert>}
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
      {startDate < today && (
        <Alert tone="info">
          Những ngày làm việc từ {dmy(startDate)} đến hôm qua sẽ tính là vắng — nhập bù giờ ở Nhân
          sự › Bảng công tháng.
        </Alert>
      )}
      <fieldset className="flex flex-col gap-3 border-t border-border pt-3">
        <legend className="text-sm font-medium">Hồ sơ (không bắt buộc)</legend>
        {oldHireDate && (
          <div
            role="radiogroup"
            aria-label="Chọn ngày vào công ty"
            className="flex flex-col gap-1 text-sm"
          >
            <label className="flex items-center gap-2">
              <input type="radio" checked={keep} onChange={() => setKeep(true)} />
              Giữ ngày vào cũ ({dmy(oldHireDate)}) — thâm niên tính tiếp
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={!keep}
                onChange={() => {
                  setKeep(false);
                  setProfile((p) => ({ ...p, hireDate: '' }));
                }}
              />
              Ngày vào mới
            </label>
          </div>
        )}
        <ProfileFields
          value={profile}
          onChange={setProfile}
          today={today}
          hideHireDate={keep && !!oldHireDate}
        />
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Hủy
        </Button>
        <Button
          loading={hire.isPending}
          disabled={
            !email.trim() ||
            !fullName.trim() ||
            !startDate ||
            (!keep && !!oldHireDate && !profile.hireDate)
          }
          onClick={() => hire.mutate()}
        >
          {rehire ? 'Nhận lại' : 'Thêm'}
        </Button>
      </div>
    </div>
  );
}
