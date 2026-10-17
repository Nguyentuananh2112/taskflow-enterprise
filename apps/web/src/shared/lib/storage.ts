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

/** Các khóa có tiền tố `prefix` (rỗng khi storage không truy cập được). */
export function localKeys(prefix: string): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

/** Xóa mọi khóa có tiền tố `prefix` (vd dọn dấu vết của user khi đăng xuất trên máy dùng chung). */
export function removeLocalByPrefix(prefix: string): void {
  localKeys(prefix).forEach(removeLocal);
}
