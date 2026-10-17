/**
 * Ảnh chụp ĐỌC nhất quán cho báo cáo dài (ADR-130 — xuất .xlsx; B review T-057): một transaction REPEATABLE READ
 * READ ONLY bao trọn mọi lô đọc ⇒ con số đếm (EXPORT_TOO_LARGE) và dữ liệu xuất khớp nhau, lệnh ghi xen giữa hai
 * lô không lọt vào (XL-07).
 *
 * TÁCH khỏi `IUnitOfWork.run` có chủ đích: `run` lồng nhau dùng lại transaction ngoài ⇒ isolation / read-only sẽ bị
 * bỏ qua âm thầm. Ở đây lồng theo CẢ HAI chiều đều là lỗi lập trình (ném ngay):
 * - gọi `run` của snapshot khi đang trong `uow.run` (`ReadSnapshotNestingError`);
 * - gọi `uow.run` khi đang trong snapshot (ghi trong báo cáo — audit phải chạy bằng `uow.run` riêng, NGOÀI snapshot).
 * Repository không đổi gì: vẫn lấy client qua `uow.db()` — trong snapshot đó là transaction chỉ đọc.
 */
export interface IReadSnapshot {
  run<T>(work: () => Promise<T>, opts: { timeoutMs: number }): Promise<T>;
}

/** Trần thời gian một snapshot (ms): Postgres giữ snapshot ⇒ chặn dọn dẹp (vacuum) — không cho mở lâu hơn. */
export const READ_SNAPSHOT_MAX_MS = 120_000;

export class ReadSnapshotNestingError extends Error {
  constructor(where: 'in-unit-of-work' | 'write-in-snapshot') {
    super(
      where === 'in-unit-of-work'
        ? 'readSnapshot.run() không được gọi bên trong uow.run() (isolation / read-only sẽ bị bỏ qua).'
        : 'uow.run() không được gọi bên trong readSnapshot.run() (snapshot chỉ đọc — ghi audit bằng uow.run riêng).',
    );
    this.name = 'ReadSnapshotNestingError';
  }
}

export function assertSnapshotTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > READ_SNAPSHOT_MAX_MS) {
    throw new RangeError(`readSnapshot: timeoutMs phải trong 1..${String(READ_SNAPSHOT_MAX_MS)}`);
  }
}
