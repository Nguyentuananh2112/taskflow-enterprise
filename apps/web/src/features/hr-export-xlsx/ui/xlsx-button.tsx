'use client';

import { useMutation } from '@tanstack/react-query';

import { isApiError, type DownloadResult } from '@/shared/api';
import { saveBlob } from '@/shared/lib/save-blob';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

const BY_RULE: Readonly<Record<string, string>> = {
  PERIOD_NOT_STARTED: 'Kỳ này chưa bắt đầu — chưa có dữ liệu để xuất.',
  EXPORT_TOO_LARGE: 'Dữ liệu quá lớn để xuất một lần — chọn khoảng ngắn hơn.',
};

function exportErrorMessage(error: unknown): string {
  if (isApiError(error, 'RATE_LIMITED')) {
    return 'Đang có nhiều file được tạo hoặc bạn vừa xuất nhiều lần — thử lại sau ít phút.';
  }
  const rule = isApiError(error) ? (error.details as { rule?: string } | null)?.rule : undefined;
  if (rule && BY_RULE[rule]) return BY_RULE[rule];
  // Lỗi giữa chừng (server cắt kết nối) ⇒ fetch reject: KHÔNG lưu file dở.
  return 'Không tạo được file, thử lại.';
}

type Props = Readonly<{
  label: string;
  download: () => Promise<DownloadResult>;
  /** Tên file khi server không gửi `Content-Disposition` (không có tên người / công ty). */
  fallbackName: string;
  disabled?: boolean;
}>;

/**
 * Tải file .xlsx do SERVER tạo (ADR-130): fetch có Bearer → Blob → lưu, tên file từ `Content-Disposition`. Đang tạo ⇒
 * nút khóa "Đang tạo file…". File chứa dữ liệu nhân viên và ra ngoài tầm kiểm soát (R34) ⇒ nhắc trên nút.
 */
export function XlsxButton({ label, download, fallbackName, disabled = false }: Props) {
  const run = useMutation({
    mutationFn: download,
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename ?? fallbackName);
      toast({ title: 'Đã tải file Excel', tone: 'success' });
    },
    onError: (error) => toast({ title: exportErrorMessage(error), tone: 'error' }),
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={disabled || run.isPending}
      title="File chứa dữ liệu của nhân viên — chỉ lưu ở nơi an toàn."
      onClick={() => run.mutate()}
    >
      {run.isPending ? 'Đang tạo file…' : label}
    </Button>
  );
}
