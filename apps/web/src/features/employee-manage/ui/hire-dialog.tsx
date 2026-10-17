'use client';

import type { ActivationDto } from '@taskflow/contracts/company';
import { useState } from 'react';

import { useEmployeeProfile } from '@/entities/company';
import { Dialog } from '@/shared/ui/dialog';
import { Skeleton } from '@/shared/ui/skeleton';

import { EMPTY_PROFILE_FORM, profileFormOf } from '../lib/profile-form';
import { HireForm, type Rehire } from './hire-form';
import { LinkBox } from './link-box';

type Props = Readonly<{
  /** Hôm nay theo SERVER (giờ lịch) — mặc định / giới hạn ngày vào làm. */
  today: string;
  onClose: () => void;
  /** Nhận lại người đã nghỉ: email + tên điền sẵn (ADR-137 — nhiệm kỳ mới, tài khoản cũ), hồ sơ cũ điền sẵn. */
  rehire?: Rehire;
}>;

/**
 * Thêm nhân viên / Nhận lại (`POST hr/employees`, Mốc 3.5 + trường hồ sơ tùy chọn của Mốc 5 — ADR-128). Email mới ⇒
 * hộp link kích hoạt MỘT lần; nhận lại người đã có mật khẩu ⇒ không cần link. Nhận lại: chờ hồ sơ cũ để điền sẵn.
 */
export function HireDialog({ today, onClose, rehire }: Props) {
  const [link, setLink] = useState<{ fullName: string; activation: ActivationDto } | null>(null);
  if (link)
    return <LinkBox fullName={link.fullName} activation={link.activation} onClose={onClose} />;
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={rehire ? `Nhận lại ${rehire.fullName}` : 'Thêm nhân viên'}
      description="Nhân viên nhận link kích hoạt để tự đặt mật khẩu. Không gửi mật khẩu qua tin nhắn."
    >
      {rehire ? (
        <RehireLoader rehire={rehire} today={today} onClose={onClose} onLink={setLink} />
      ) : (
        <HireForm before={EMPTY_PROFILE_FORM} today={today} onClose={onClose} onLink={setLink} />
      )}
    </Dialog>
  );
}

type LoaderProps = Readonly<{
  rehire: Rehire;
  today: string;
  onClose: () => void;
  onLink: (link: { fullName: string; activation: ActivationDto }) => void;
}>;

function RehireLoader({ rehire, today, onClose, onLink }: LoaderProps) {
  const old = useEmployeeProfile(rehire.userId);
  // Không đọc được hồ sơ cũ ⇒ vẫn cho nhận lại (như Mốc 3.5), không điền sẵn.
  if (old.isPending)
    return (
      <div role="status" aria-busy="true" aria-label="Đang tải hồ sơ cũ" className="grid gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  return (
    <HireForm
      rehire={rehire}
      before={old.data ? profileFormOf(old.data) : EMPTY_PROFILE_FORM}
      today={today}
      onClose={onClose}
      onLink={onLink}
    />
  );
}
