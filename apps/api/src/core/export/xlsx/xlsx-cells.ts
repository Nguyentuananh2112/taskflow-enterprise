// Ô và tên của bảng tính .xlsx tự ghi (ADR-130; B review T-055x) — HÀM THUẦN, không phụ thuộc fflate.
// Luật cứng: KHÔNG BAO GIỜ sinh công thức (`<f>`); mọi chuỗi là inline string; chuỗi bắt đầu bằng ký tự có thể bị
// Excel hiểu là công thức / DDE (= + - @ TAB CR) ⇒ đánh dấu `quotePrefix` (Excel hiển thị đúng chữ, không tính).

/**
 * Ngày lịch thuần (không giờ, không múi giờ) — ghi ra số serial Excel + định dạng `dd/mm/yyyy` để Excel sắp / lọc được
 * (TL 18/10 theo F). Tạo bằng `xlsxDate('YYYY-MM-DD')`.
 */
export interface XlsxDate {
  readonly date: string;
}

/** Giá trị một ô: chuỗi (inline string), số hữu hạn, ngày (`XlsxDate`), hoặc trống. */
export type CellValue = string | number | XlsxDate | null;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Số ngày từ 1970-01-01 của một ngày lịch Gregory (H. Hinnant, days_from_civil) — số học thuần, không `Date`. */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

const daysInMonth = (y: number, m: number) =>
  m === 2
    ? y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
      ? 29
      : 28
    : [4, 6, 9, 11].includes(m)
      ? 30
      : 31;

/** Serial Excel (hệ 1900) của 1970-01-01. Gốc 1899-12-30 đúng cho mọi ngày từ 1900-03-01 (lỗi năm nhuận 1900 của Excel). */
const EXCEL_EPOCH_1970 = 25_569;

/**
 * Số serial Excel của `YYYY-MM-DD`. Sai định dạng / ngày không tồn tại (30/02) / trước 1900-03-01 ⇒ ném lỗi (lỗi lập
 * trình — dữ liệu ngày trong hệ thống luôn là ngày hợp lệ).
 */
export function excelSerial(iso: string): number {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Ngày không đúng dạng YYYY-MM-DD: ${iso}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo))
    throw new Error(`Ngày không tồn tại: ${iso}`);
  const serial = daysFromCivil(y, mo, d) + EXCEL_EPOCH_1970;
  if (serial < 61) throw new Error(`Ngày trước 1900-03-01 không ghi được dạng ngày Excel: ${iso}`);
  return serial;
}

/** Ô ngày; kiểm tra ngay khi tạo (lỗi chỉ ra đúng chỗ dựng dữ liệu, không phải giữa lúc stream). */
export function xlsxDate(iso: string): XlsxDate {
  excelSerial(iso);
  return { date: iso };
}

/** Ký tự Excel / LibreOffice có thể diễn giải thành công thức hoặc DDE khi đứng đầu ô (OWASP CSV injection). */
const FORMULA_LEAD = new Set(['=', '+', '-', '@', '\t', '\r']);

export function needsQuotePrefix(text: string): boolean {
  return text.length > 0 && FORMULA_LEAD.has(text[0]!);
}

/**
 * Bỏ ký tự CẤM trong XML 1.0: U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF và surrogate LẺ (không
 * thành cặp). Giữ TAB, LF, CR. Duyệt theo đơn vị UTF-16 để phát hiện surrogate lẻ.
 */
export function stripXmlForbidden(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i++;
      }
      continue; // high surrogate lẻ
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue; // low surrogate lẻ
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    if (c === 0xfffe || c === 0xffff) continue;
    out += text[i]!;
  }
  return out;
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escape đủ 5 ký tự (dùng được cả trong nội dung lẫn thuộc tính). */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]!);
}

/** Tên cột kiểu A, B, …, Z, AA, … (0-based). */
export function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * Style id trong styles.xml (xlsx-parts.ts): 0 thường, 1 quotePrefix, 2 tiêu đề đậm, 3 tiêu đề đậm + quotePrefix,
 * 4 ngày `dd/mm/yyyy`.
 */
export const STYLE = { normal: 0, quoted: 1, header: 2, headerQuoted: 3, date: 4 } as const;

/**
 * XML của một ô tại `ref` (vd `B7`). Chuỗi ⇒ `<c t="inlineStr"><is><t>`; số hữu hạn ⇒ `<v>`; ngày ⇒ `<v>` serial +
 * style ngày; null / chuỗi rỗng sau lọc ⇒ không sinh ô. Không bao giờ có `<f>`.
 */
export function cellXml(ref: string, value: CellValue, opts: { header?: boolean } = {}): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Ô ${ref}: số không hữu hạn`);
    return `<c r="${ref}"><v>${String(value)}</v></c>`;
  }
  if (typeof value === 'object') {
    return `<c r="${ref}" s="${String(STYLE.date)}"><v>${String(excelSerial(value.date))}</v></c>`;
  }
  const text = stripXmlForbidden(value);
  if (text === '') return '';
  // B L1: tiêu đề cũng có thể đến từ dữ liệu (tên phòng ban…) ⇒ quotePrefix áp cho cả tiêu đề.
  const quoted = needsQuotePrefix(text);
  const style = opts.header
    ? quoted
      ? STYLE.headerQuoted
      : STYLE.header
    : quoted
      ? STYLE.quoted
      : STYLE.normal;
  const s = style === STYLE.normal ? '' : ` s="${String(style)}"`;
  // B L2: CR thô bị parser XML chuẩn hóa thành LF ⇒ ghi tham chiếu ký tự để giữ nguyên.
  const body = escapeXml(text).replaceAll('\r', '&#13;');
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${body}</t></is></c>`;
}

/** Một hàng (`rowNumber` 1-based). */
export function rowXml(rowNumber: number, values: readonly CellValue[], header = false): string {
  const cells = values
    .map((v, i) => cellXml(`${columnName(i)}${String(rowNumber)}`, v, { header }))
    .join('');
  return `<row r="${String(rowNumber)}">${cells}</row>`;
}

/**
 * Tên sheet hợp lệ cho Excel: ≤ 31 ký tự, không `: \ / ? * [ ]`, không bắt đầu / kết thúc bằng `'`, không rỗng;
 * trùng ⇒ thêm hậu tố ` (2)`… (`used` giữ các tên đã dùng, so không phân biệt hoa thường).
 */
export function sheetName(raw: string, used: Set<string>): string {
  let base = stripXmlForbidden(raw)
    .replace(/[:\\/?*[\]]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim();
  if (base === '') base = 'Sheet';
  base = base.slice(0, 31);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${String(n)})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}
