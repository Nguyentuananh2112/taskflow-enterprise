'use client';

import { daysText, useLeavePreview } from '@/entities/leave';
import type { SubmitLeaveBody } from '@taskflow/contracts/leave';

import { leaveSubmitError } from '../model/leave-errors';

type Draft = Pick<SubmitLeaveBody, 'type' | 'startDate' | 'endDate' | 'dayPart'>;
type Props = Readonly<{ wsId: string; draft: Draft | null }>;

/**
 * "Đơn này: 2,5 ngày làm việc · phép năm còn 7 ngày" — số do SERVER đếm theo lịch + ngày lễ (chỉ tham
 * khảo; gửi đơn vẫn kiểm lại). Lỗi (vd không đủ phép) hiện ngay, trước khi bấm gửi. `aria-live` để trình
 * đọc màn hình biết số thay đổi.
 */
export function LeavePreview({ wsId, draft }: Props) {
  const preview = useLeavePreview(wsId, draft);
  let text = '';
  let tone = 'text-text-muted';
  if (draft && preview.data) {
    const { days, remainingDays } = preview.data;
    text = `Đơn này: ${daysText(days)} làm việc${remainingDays === null ? '' : ` · phép năm còn ${daysText(remainingDays)}`}`;
  } else if (draft && preview.isError) {
    text = leaveSubmitError(preview.error).message;
    tone = 'text-danger';
  }
  return (
    <p aria-live="polite" className={`min-h-5 text-sm ${tone}`}>
      {text}
    </p>
  );
}
