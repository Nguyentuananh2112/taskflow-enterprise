/**
 * Lưu Blob thành file tải về (CSV — attendance-leave §5): object URL + `<a download>` tạm, thu hồi URL
 * ngay sau khi bấm để không giữ dữ liệu trong bộ nhớ trình duyệt.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
