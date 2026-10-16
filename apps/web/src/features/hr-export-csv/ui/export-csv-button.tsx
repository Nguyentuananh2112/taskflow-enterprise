'use client';

import { useMutation } from '@tanstack/react-query';

import { hrAttendanceApi } from '@/entities/hr';
import { isApiError } from '@/shared/api';
import { saveBlob } from '@/shared/lib/save-blob';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{ wsId: string; month: string }>;

/**
 * Xuất CSV bảng công tháng cả công ty (§5): fetch có Bearer → Blob → tải (không URL ký). Server ghi audit
 * EXPORT + hạn mức; CSV không có IP/UA và đã chống CSV injection (B-M5). File đã tải ra ngoài tầm kiểm soát
 * của hệ thống (R28) ⇒ nhắc người dùng ngay trên nút.
 */
export function ExportCsvButton({ wsId, month }: Props) {
  const exportCsv = useMutation({
    mutationFn: () => hrAttendanceApi.exportCsv(wsId, month),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename ?? `cham-cong-${month}.csv`);
      toast({ title: 'Đã xuất bảng công', tone: 'success' });
    },
    onError: (error) =>
      toast({
        title: isApiError(error, 'RATE_LIMITED')
          ? 'Bạn vừa xuất nhiều lần — vui lòng thử lại sau ít phút.'
          : 'Không xuất được bảng công. Vui lòng thử lại.',
        tone: 'error',
      }),
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={exportCsv.isPending}
      title="File chứa dữ liệu cá nhân của nhân viên — chỉ lưu ở nơi an toàn."
      onClick={() => exportCsv.mutate()}
    >
      Xuất CSV
    </Button>
  );
}
