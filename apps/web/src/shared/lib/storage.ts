// Wrapper DUY NHẤT cho localStorage (ADR-026; eslint chỉ mở ngoại lệ cho file này). Chỉ cho dữ liệu
// KHÔNG nhạy cảm (vd lựa chọn theme). Mọi truy cập bọc try/catch: chế độ riêng tư, quota, storage bị
// chặn ⇒ coi như không có giá trị, không làm hỏng app.

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Không lưu được ⇒ lựa chọn chỉ sống trong phiên trang hiện tại.
  }
}

export function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Không xóa được ⇒ bỏ qua (giá trị cũ sẽ bị đọc như hiện tại).
  }
}
