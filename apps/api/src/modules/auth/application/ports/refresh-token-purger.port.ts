/**
 * Xóa refresh token đã hết hạn quá thời gian giữ (security.md §2.2 — G2 S2). Gọi BÊN TRONG
 * `uow.run` (một transaction mỗi lô): hiện thực lấy khóa advisory của lô trong transaction đó.
 */
export interface IRefreshTokenPurger {
  /**
   * Xóa tối đa `limit` dòng có `family_expires_at < cutoff` — cả phiên đã hết hạn tuyệt đối (cũ nhất
   * trước). Trả số dòng đã xóa, hoặc
   * `null` khi instance khác đang chạy một lô (không phải lỗi — bỏ lượt).
   */
  purgeExpired(cutoff: Date, limit: number): Promise<number | null>;
}
