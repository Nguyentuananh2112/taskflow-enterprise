// Ô và tên của bảng tính .xlsx tự ghi (ADR-130; B review T-055x) — HÀM THUẦN, không phụ thuộc fflate.
// Luật cứng: KHÔNG BAO GIỜ sinh công thức (`<f>`); mọi chuỗi là inline string; chuỗi bắt đầu bằng ký tự có thể bị
// Excel hiểu là công thức / DDE (= + - @ TAB CR) ⇒ đánh dấu `quotePrefix` (Excel hiển thị đúng chữ, không tính).

/** Giá trị một ô: chuỗi (inline string), số hữu hạn, hoặc trống. Ngày ghi dạng chuỗi `YYYY-MM-DD` (không phụ thuộc vùng). */
export type CellValue = string | number | null;

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

/** Style id trong styles.xml (xlsx-parts.ts): 0 thường, 1 chữ có quotePrefix, 2 tiêu đề đậm. */
export const STYLE = { normal: 0, quoted: 1, header: 2 } as const;

/**
 * XML của một ô tại `ref` (vd `B7`). Chuỗi ⇒ `<c t="inlineStr"><is><t>`; số hữu hạn ⇒ `<v>`; null / chuỗi rỗng sau
 * lọc ⇒ không sinh ô. Không bao giờ có `<f>`.
 */
export function cellXml(ref: string, value: CellValue, opts: { header?: boolean } = {}): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Ô ${ref}: số không hữu hạn`);
    return `<c r="${ref}"><v>${String(value)}</v></c>`;
  }
  const text = stripXmlForbidden(value);
  if (text === '') return '';
  const style = opts.header ? STYLE.header : needsQuotePrefix(text) ? STYLE.quoted : STYLE.normal;
  const s = style === STYLE.normal ? '' : ` s="${String(style)}"`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
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
