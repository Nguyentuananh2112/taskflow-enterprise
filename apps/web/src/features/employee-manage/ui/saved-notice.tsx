import type { PutEmployeeProfileResponse } from '@taskflow/contracts/company';

import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';

/** Lưu xong nhưng có hệ quả cần HR biết: phép năm bị âm, điều chỉnh phép cũ cần xem lại. */
export function SavedNotice({
  result,
  onClose,
}: Readonly<{ result: PutEmployeeProfileResponse; onClose: () => void }>) {
  return (
    <div className="flex flex-col gap-3">
      <Alert tone="success">Đã lưu hồ sơ.</Alert>
      {result.negativeBalances.length > 0 && (
        <Alert tone="info">
          Sau khi đổi ngày vào, số phép còn lại bị âm:{' '}
          {result.negativeBalances.map((b) => `năm ${b.year}: ${b.remainingDays} ngày`).join('; ')}.
          Kiểm tra ở Nhân sự › Số phép.
        </Alert>
      )}
      {result.warnings.includes('ADJUSTMENT_DAYS_REVIEW') && (
        <Alert tone="info">
          Trước đây phép năm đầu bị trừ theo tỷ lệ — nay công ty cho đủ. Kiểm tra lại số ngày điều
          chỉnh ở Nhân sự › Số phép.
        </Alert>
      )}
      <Button className="self-end" onClick={onClose}>
        Đóng
      </Button>
    </div>
  );
}
