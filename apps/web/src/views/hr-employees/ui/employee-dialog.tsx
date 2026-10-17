'use client';

import type { EmployeeDto } from '@taskflow/contracts/company';

import { HireDialog, OffboardDialog, ProfileDialog } from '@/features/employee-manage';

export type DialogState =
  { kind: 'hire' } | { kind: 'offboard' | 'rehire' | 'profile'; employee: EmployeeDto };

type Props = Readonly<{ dialog: DialogState; today: string; onClose: () => void }>;

/** Hộp thoại ở CẤP TRANG (không trong dòng) ⇒ người đổi trạng thái rời bộ lọc vẫn thấy kết quả (F, E2E-HR-19). */
export function EmployeeDialog({ dialog, today, onClose }: Props) {
  if (dialog.kind === 'hire') return <HireDialog today={today} onClose={onClose} />;
  const e = dialog.employee;
  if (dialog.kind === 'offboard')
    return <OffboardDialog employee={e} today={today} onClose={onClose} />;
  if (dialog.kind === 'profile')
    return (
      <ProfileDialog userId={e.userId} fullName={e.fullName} today={today} onClose={onClose} />
    );
  return (
    <HireDialog
      today={today}
      rehire={{ userId: e.userId, email: e.email, fullName: e.fullName }}
      onClose={onClose}
    />
  );
}
