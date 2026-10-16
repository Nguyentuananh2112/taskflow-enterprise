/** Ký tự đầu ô khiến Excel / Sheets hiểu là công thức (OWASP CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Ô CSV: luôn bọc `"` và nhân đôi `"` bên trong. Ô CHỮ do người dùng nhập (`text`) thêm tiền tố `'` khi bắt đầu
 * bằng `= + - @ \t \r`; ô số / ngày / giờ do server sinh (`raw`) giữ nguyên — vd `-` không bị đổi (B-L3, §9).
 */
export function csvCell(value: string | number, kind: 'text' | 'raw' = 'raw'): string {
  let s = String(value);
  if (kind === 'text' && FORMULA_START.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export const csvRow = (cells: readonly string[]) => `${cells.join(',')}\r\n`;

/** UTF-8 BOM để Excel đọc đúng tiếng Việt. */
export const CSV_BOM = '\uFEFF';
