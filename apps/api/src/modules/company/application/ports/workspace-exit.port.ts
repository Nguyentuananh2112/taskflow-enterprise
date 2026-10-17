/**
 * Workspace khi một người rời công ty (ADR-137 "Hoàn tất" bước 3) — module workspace hiện thực, wire ở composition
 * (ADR-093). Gọi TRONG transaction hoàn tất, SAU khi đã xóa dòng `company_members`.
 */
export interface IWorkspaceExitPort {
  /**
   * Rời MỌI workspace (kể cả đã xóa mềm): khóa OWNER của ws (ADR-046) → xóa membership → bỏ gán task (ADR-044);
   * sau commit thu hồi phòng socket. `orphaned` = ws còn sống mà người này là OWNER cuối cùng (Admin xử lý — R39).
   */
  endMembership(input: {
    userId: string;
    actorId: string;
  }): Promise<{ workspaceIds: string[]; orphaned: string[] }>;
  /** Cảnh báo khi lên lịch: ws còn sống mà người này là OWNER DUY NHẤT (chỉ đọc). */
  soleOwnerWorkspaces(userId: string): Promise<{ id: string; name: string }[]>;
}
