/**
 * Ca phụ thuộc nhánh web/API chưa merge (Mốc 6: T-068 avatar, T-069/T-070 chat): chạy khi `E2E_RUN_PENDING` (phân
 * cách dấu phẩy, hoặc `all`) chứa vé — như `SEC_RUN_PENDING` của suite bảo mật. Dùng
 * `test.fixme(awaiting('T-068'), '[PENDING T-068] …')` ⇒ LUÔN hiện là fixme trong báo cáo, không xanh giả. Gỡ khi vé
 * vào nhánh tích hợp (như 598ea276 đã gỡ cho Mốc 3.5).
 */
export function awaiting(...tickets: string[]): boolean {
  const tags = (process.env.E2E_RUN_PENDING ?? '').split(',').map((t) => t.trim());
  return !tags.includes('all') && !tickets.every((t) => tags.includes(t));
}
