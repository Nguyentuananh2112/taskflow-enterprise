import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { inflateRawSync } from 'node:zlib';

import { expect } from 'vitest';

import type { ApiUnderTest } from './suite';

/**
 * Đọc .xlsx trong test (test-spec-hr-extended §1.2, ADR-130). Bộ đọc **độc lập** với bộ ghi của API (B dùng `fflate`
 * ở T-055): unzip bằng `node:zlib` + parse XML tối thiểu — không thêm thư viện, và lỗi của bộ ghi không bị che bởi
 * cùng một thư viện ở hai đầu. Chỉ phủ phần OOXML mà ADR-130 cho phép (inlineStr, số, ngày, style); thấy thứ khác
 * (sharedStrings, công thức, hyperlink…) thì `expectSafeWorkbook` báo đỏ.
 */

// ---------------------------------------------------------------- ZIP

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. */
  method: number;
  data: Buffer;
}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;
const SIG_EOCD64_LOC = 0x07064b50;

/** Đọc ZIP theo central directory (đúng cả khi bộ ghi stream dùng data descriptor — local header size = 0). */
export function unzip(buf: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('không phải ZIP (không có EOCD) — file cụt?');
  let count = buf.readUInt16LE(eocd + 10);
  let cenAt = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cenAt === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== SIG_EOCD64_LOC) throw new Error('ZIP64 thiếu locator');
    const eocd64 = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(eocd64 + 32));
    cenAt = Number(buf.readBigUInt64LE(eocd64 + 48));
  }
  const out: ZipEntry[] = [];
  let at = cenAt;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(at) !== SIG_CEN) throw new Error(`central directory hỏng ở entry ${i}`);
    const method = buf.readUInt16LE(at + 10);
    let compSize = buf.readUInt32LE(at + 20);
    let size = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    let localAt = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    // Extra ZIP64 (0x0001): các trường = 0xFFFFFFFF lấy từ đây, theo thứ tự size, compSize, offset.
    const extra = buf.subarray(at + 46 + nameLen, at + 46 + nameLen + extraLen);
    for (let e = 0; e + 4 <= extra.length;) {
      const id = extra.readUInt16LE(e);
      const len = extra.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let p = e + 4;
        const next = () => {
          const v = Number(extra.readBigUInt64LE(p));
          p += 8;
          return v;
        };
        if (size === 0xffffffff) size = next();
        if (compSize === 0xffffffff) compSize = next();
        if (localAt === 0xffffffff) localAt = next();
      }
      e += 4 + len;
    }
    if (buf.readUInt32LE(localAt) !== SIG_LOC) throw new Error(`local header hỏng: ${name}`);
    const dataAt = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(dataAt, dataAt + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`${name}: phương thức nén ${method} không hỗ trợ`);
    if (data.length !== size) throw new Error(`${name}: ${data.length} byte ≠ khai ${size}`);
    out.push({ name, method, data });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// ---------------------------------------------------------------- XML tối thiểu

export interface XmlNode {
  /** Tên đầy đủ kể cả prefix (`x:row`, `r:id`…). */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text trực tiếp (đã giải entity), nối theo thứ tự. */
  text: string;
}

/** Ký tự cấm trong XML 1.0 (ADR-130: phải đã bị thay bằng U+FFFD). */
export const XML_ILLEGAL = new RegExp(
  [
    '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]',
    '[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])',
    '(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]',
  ].join('|'),
);

function decodeEntities(s: string, where: string): string {
  const bad = /&(?!(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.exec(s);
  if (bad)
    throw new Error(
      `${where}: '&' không phải entity hợp lệ — ${s.slice(bad.index, bad.index + 12)}`,
    );
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all, ent: string) => {
    if (ent === 'amp') return '&';
    if (ent === 'lt') return '<';
    if (ent === 'gt') return '>';
    if (ent === 'quot') return '"';
    if (ent === 'apos') return "'";
    const cp = ent.startsWith('#x') ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    const ch = String.fromCodePoint(cp);
    if (XML_ILLEGAL.test(ch)) throw new Error(`${where}: tham chiếu ký tự cấm ${all}`);
    return ch;
  });
}

/**
 * Parse XML well-formed (không DTD, không entity tự định nghĩa — gặp `<!DOCTYPE` là ném lỗi). Ném lỗi khi thẻ lệch
 * ⇒ "file mở được" ở mức cấu trúc. Không phải parser đầy đủ: đủ cho OOXML do API ghi.
 */
export function parseXml(xml: string, where = 'xml'): XmlNode {
  if (XML_ILLEGAL.test(xml)) throw new Error(`${where}: chứa ký tự cấm XML 1.0`);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`${where}: có DTD/ENTITY`);
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re =
    /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(xml))) {
    if (m.index !== consumed) throw new Error(`${where}: XML hỏng ở vị trí ${consumed}`);
    consumed = re.lastIndex;
    const top = stack[stack.length - 1] as XmlNode;
    const [all, cdata, close, name, rawAttrs, selfClose, text] = m;
    if (all.startsWith('<?') || all.startsWith('<!--')) continue;
    if (cdata !== undefined) {
      top.text += cdata;
    } else if (text !== undefined) {
      if (text.includes(']]>')) throw new Error(`${where}: ']]>' trong text`);
      top.text += decodeEntities(text, where);
    } else if (close) {
      if (top.name !== name) throw new Error(`${where}: </${name}> đóng <${top.name}>`);
      stack.pop();
    } else if (name) {
      const attrs: Record<string, string> = {};
      for (const a of (rawAttrs ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const key = a[1] as string;
        if (key in attrs) throw new Error(`${where}: thuộc tính lặp ${key} trên <${name}>`);
        attrs[key] = decodeEntities(a[2] ?? a[3] ?? '', where);
      }
      const node: XmlNode = { name, attrs, children: [], text: '' };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    }
  }
  if (consumed !== xml.length) throw new Error(`${where}: XML hỏng ở vị trí ${consumed}`);
  if (stack.length !== 1) throw new Error(`${where}: thiếu thẻ đóng </${stack.at(-1)?.name}>`);
  if (root.text.trim() !== '' || root.children.length !== 1)
    throw new Error(`${where}: phải có đúng một phần tử gốc`);
  return root.children[0] as XmlNode;
}

/** Tên cục bộ (bỏ prefix namespace). */
const local = (n: XmlNode) => n.name.slice(n.name.indexOf(':') + 1);

export function childrenOf(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => local(c) === name);
}
export function firstOf(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => local(c) === name);
}
/** Mọi hậu duệ có tên cục bộ `name` (duyệt sâu). */
export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (local(c) === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

// ---------------------------------------------------------------- Workbook

export interface CellStyle {
  numFmtId: number;
  /** Mã định dạng (built-in hoặc `numFmts`). */
  formatCode: string | undefined;
  quotePrefix: boolean;
}

export interface Cell {
  /** `A1`. */
  ref: string;
  col: number;
  row: number;
  /** Thuộc tính `t` (`inlineStr`, `n`, `s`, `str`, `b`, `e`…); vắng = số. */
  type: string;
  /** Chuỗi (inlineStr — nối mọi `<t>`), số (`<v>`), hoặc `null` (ô rỗng chỉ có style). */
  value: string | number | null;
  style: CellStyle;
  /** Ô có `<f>` — ADR-130 cấm tuyệt đối. */
  hasFormula: boolean;
}

export interface Sheet {
  name: string;
  /** Thuộc tính `state` (`hidden`/`veryHidden`) nếu có. */
  state: string | undefined;
  path: string;
  xml: string;
  root: XmlNode;
  cells: Cell[];
  /** Bảng giá trị theo dòng/cột (chỉ số 0), ô thiếu = `null`. */
  rows: (string | number | null)[][];
  cell(ref: string): Cell | undefined;
}

export interface Workbook {
  /** Tên entry theo thứ tự trong central directory. */
  names: string[];
  files: Map<string, Buffer>;
  text(name: string): string | undefined;
  sheets: Sheet[];
  sheet(name: string): Sheet;
  styles: CellStyle[];
  /** `docProps/core.xml` dạng { tên cục bộ ⇒ text } (vd `creator`). */
  core: Record<string, string> | undefined;
  workbookRoot: XmlNode;
}

/** Built-in numFmtId ngày/giờ (ECMA-376 §18.8.30). */
const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  14: 'mm-dd-yy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yy h:mm',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  49: '@',
};

/** Định dạng là ngày/giờ (có d/m/y/h/s ngoài chuỗi trích dẫn và `[...]` màu). */
export function isDateFormat(code: string | undefined): boolean {
  if (!code) return false;
  const bare = code.replace(/"[^"]*"|\\.|\[(?!h\]|m\]|s\])[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^[#0.,%\s]*$/.test(bare);
}

/** Số serial Excel (hệ 1900) ⇒ `YYYY-MM-DD` (+ `THH:mm:ss` nếu có phần giờ). */
export function serialToIso(serial: number): string {
  // 25569 = 1970-01-01; Excel coi 1900 là năm nhuận ⇒ serial < 61 lệch 1 ngày (không gặp với dữ liệu ≥ 1950).
  const ms = Math.round((serial - 25569) * 86_400_000);
  const iso = new Date(ms).toISOString();
  return Number.isInteger(serial) ? iso.slice(0, 10) : iso.slice(0, 19);
}

function colOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function resolveTarget(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export function readXlsx(buf: Buffer): Workbook {
  const entries = unzip(buf);
  const files = new Map(entries.map((e) => [e.name, e.data]));
  if (files.size !== entries.length) throw new Error('ZIP có entry trùng tên');
  const text = (name: string) => files.get(name)?.toString('utf8');
  const need = (name: string) => {
    const t = text(name);
    if (t === undefined) throw new Error(`thiếu ${name}`);
    return t;
  };

  // styles
  const styles: CellStyle[] = [];
  const stylesXml = text('xl/styles.xml');
  if (stylesXml !== undefined) {
    const root = parseXml(stylesXml, 'xl/styles.xml');
    const custom = new Map<number, string>();
    for (const f of findAll(root, 'numFmt'))
      custom.set(Number(f.attrs['numFmtId']), f.attrs['formatCode'] ?? '');
    const cellXfs = firstOf(root, 'cellXfs');
    for (const xf of cellXfs ? childrenOf(cellXfs, 'xf') : []) {
      const id = Number(xf.attrs['numFmtId'] ?? 0);
      styles.push({
        numFmtId: id,
        formatCode: custom.get(id) ?? BUILTIN_FORMATS[id],
        quotePrefix: xf.attrs['quotePrefix'] === '1' || xf.attrs['quotePrefix'] === 'true',
      });
    }
  }
  const styleOf = (s: string | undefined): CellStyle => {
    const idx = Number(s ?? 0);
    const st = styles[idx];
    if (!st && idx !== 0) throw new Error(`style s="${idx}" không có trong cellXfs`);
    return st ?? { numFmtId: 0, formatCode: 'General', quotePrefix: false };
  };

  // workbook + rels
  const workbookRoot = parseXml(need('xl/workbook.xml'), 'xl/workbook.xml');
  const relsRoot = parseXml(need('xl/_rels/workbook.xml.rels'), 'xl/_rels/workbook.xml.rels');
  const rels = new Map(
    childrenOf(relsRoot, 'Relationship').map((r) => [r.attrs['Id'], r.attrs['Target'] ?? '']),
  );
  const sheetsNode = firstOf(workbookRoot, 'sheets');
  const sheets: Sheet[] = (sheetsNode ? childrenOf(sheetsNode, 'sheet') : []).map((s) => {
    const rid = Object.entries(s.attrs).find(([k]) => k.endsWith(':id'))?.[1];
    const target = rels.get(rid);
    if (!target) throw new Error(`sheet "${s.attrs['name']}": r:id ${rid} không có trong rels`);
    const path = resolveTarget('xl/workbook.xml', target);
    const xml = need(path);
    const root = parseXml(xml, path);
    const cells: Cell[] = [];
    const data = firstOf(root, 'sheetData');
    for (const [ri, row] of (data ? childrenOf(data, 'row') : []).entries()) {
      for (const [ci, c] of childrenOf(row, 'c').entries()) {
        const ref = c.attrs['r'] ?? `${String.fromCharCode(65 + ci)}${ri + 1}`;
        const type = c.attrs['t'] ?? 'n';
        let value: string | number | null = null;
        if (type === 'inlineStr') {
          const is = firstOf(c, 'is');
          value = is
            ? findAll(is, 't')
                .map((t) => t.text)
                .join('')
            : '';
        } else {
          const v = firstOf(c, 'v');
          if (v) value = type === 'n' ? Number(v.text) : v.text;
        }
        cells.push({
          ref,
          col: colOf(ref),
          row: Number(/\d+$/.exec(ref)?.[0] ?? ri + 1) - 1,
          type,
          value,
          style: styleOf(c.attrs['s']),
          hasFormula: firstOf(c, 'f') !== undefined,
        });
      }
    }
    const rows: (string | number | null)[][] = [];
    for (const c of cells) {
      const r = (rows[c.row] ??= []);
      r[c.col] = c.value;
    }
    for (let i = 0; i < rows.length; i += 1) {
      const r = (rows[i] ??= []);
      for (let j = 0; j < r.length; j += 1) r[j] ??= null;
    }
    return {
      name: s.attrs['name'] ?? '',
      state: s.attrs['state'],
      path,
      xml,
      root,
      cells,
      rows,
      cell: (r: string) => cells.find((c) => c.ref === r),
    };
  });

  const coreXml = text('docProps/core.xml');
  let core: Record<string, string> | undefined;
  if (coreXml !== undefined) {
    const root = parseXml(coreXml, 'docProps/core.xml');
    core = Object.fromEntries(root.children.map((c) => [local(c), c.text]));
  }

  return {
    names: entries.map((e) => e.name),
    files,
    text,
    sheets,
    sheet(name) {
      const s = sheets.find((x) => x.name === name);
      if (!s)
        throw new Error(`không có sheet "${name}" (có: ${sheets.map((x) => x.name).join(', ')})`);
      return s;
    },
    styles,
    core,
    workbookRoot,
  };
}

/** Ô chữ phải mang `quotePrefix` (ADR-130): bắt đầu bằng `=` `+` `-` `@` TAB CR. */
export const NEEDS_QUOTE_PREFIX = /^[=+\-@\t\r]/;

/**
 * Bất biến an toàn của mọi file xuất (SEC-HR-53/54, ADR-130). Trả danh sách vi phạm (rỗng = đạt) để ca gộp với thông
 * tin ngữ cảnh; `expectSafeWorkbook` là bản `expect`.
 */
export function workbookViolations(wb: Workbook): string[] {
  const v: string[] = [];
  const banned = [
    'xl/sharedStrings.xml',
    'docProps/app.xml',
    'xl/vbaProject.bin',
    'xl/calcChain.xml',
    'docProps/custom.xml',
  ];
  for (const name of wb.names) {
    if (banned.includes(name)) v.push(`có ${name}`);
    if (
      /^xl\/(externalLinks|embeddings|activeX|ctrlProps|connections|queryTables|pivot)/.test(name)
    )
      v.push(`có ${name}`);
    if (/\.(bin|vml)$/i.test(name)) v.push(`có ${name}`);
  }
  const ct = wb.text('[Content_Types].xml') ?? '';
  if (!ct) v.push('thiếu [Content_Types].xml');
  if (/macroEnabled|vbaProject/i.test(ct)) v.push('[Content_Types].xml khai macro');
  if (findAll(wb.workbookRoot, 'definedName').length > 0) v.push('workbook có definedNames');
  if (findAll(wb.workbookRoot, 'externalReference').length > 0)
    v.push('workbook có externalReferences');
  for (const s of wb.sheets) {
    if (s.state) v.push(`sheet "${s.name}" state=${s.state}`);
    if (findAll(s.root, 'hyperlink').length > 0) v.push(`sheet "${s.name}" có hyperlink`);
    if (/<(\w+:)?f[\s>/]/.test(s.xml)) v.push(`sheet "${s.name}" có <f>`);
    for (const c of s.cells) {
      if (c.hasFormula) v.push(`${s.name}!${c.ref} có công thức`);
      if (!['inlineStr', 'n'].includes(c.type)) v.push(`${s.name}!${c.ref} kiểu t="${c.type}"`);
      if (typeof c.value === 'string') {
        if (NEEDS_QUOTE_PREFIX.test(c.value) && !c.style.quotePrefix)
          v.push(`${s.name}!${c.ref} "${c.value.slice(0, 20)}" thiếu quotePrefix`);
        if (c.value.startsWith("'")) v.push(`${s.name}!${c.ref} bị thêm dấu '`);
      }
    }
  }
  for (const [name, data] of wb.files) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const t = data.toString('utf8');
    if (/TargetMode\s*=\s*"External"/.test(t)) v.push(`${name} có quan hệ External`);
  }
  if (wb.core) {
    for (const k of ['lastModifiedBy', 'Company', 'Manager'])
      if (k in wb.core) v.push(`core.xml có ${k}`);
  }
  return v;
}

export function expectSafeWorkbook(wb: Workbook, what = 'xlsx'): void {
  expect(workbookViolations(wb), what).toEqual([]);
}

// ---------------------------------------------------------------- Tải file

export interface Download {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** Body JSON (lỗi 4xx) hoặc `undefined`. */
  json: unknown;
  /** Kết nối bị server cắt giữa chừng (ADR-130 `socket.destroy()` — XL-06). */
  aborted: boolean;
}

/** GET nhị phân có Bearer (rawRequest đọc body thành utf8 ⇒ hỏng zip). */
export function download(
  api: ApiUnderTest,
  token: string | undefined,
  path: string,
  headers: Record<string, string> = {},
): Promise<Download> {
  const url = new URL(`/api/v1${path}`, api.baseUrl);
  const h: Record<string, string> = { origin: api.webOrigin, ...headers };
  if (token) h['authorization'] = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', headers: h, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let aborted = false;
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('aborted', () => (aborted = true));
      res.on('error', () => (aborted = true));
      res.on('close', () => {
        const body = Buffer.concat(chunks);
        let json: unknown;
        if (/json/.test(String(res.headers['content-type']))) {
          try {
            json = JSON.parse(body.toString('utf8'));
          } catch {
            json = undefined;
          }
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          json,
          aborted: aborted || !res.complete,
        });
      });
    });
    req.on('error', (err: NodeJS.ErrnoException) => {
      if (['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err.code ?? '')) {
        resolve({ status: 0, headers: {}, body: Buffer.alloc(0), json: undefined, aborted: true });
      } else reject(err);
    });
    req.end();
  });
}

/** Header bắt buộc của export .xlsx (ADR-130, SEC-HR-52). */
export function expectXlsxHeaders(res: Download, filename: RegExp): void {
  expect(res.status, res.body.toString('utf8').slice(0, 200)).toBe(200);
  expect(res.headers['content-type']).toBe(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const cd = String(res.headers['content-disposition']);
  const name = /^attachment; filename="([^"]+)"$/.exec(cd)?.[1];
  expect(name, `Content-Disposition: ${cd}`).toMatch(filename);
  expect(res.headers['cache-control']).toMatch(/no-store/);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(String(res.headers['access-control-expose-headers'])).toMatch(/Content-Disposition/i);
}
