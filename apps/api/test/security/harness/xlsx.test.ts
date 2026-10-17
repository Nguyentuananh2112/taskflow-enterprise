import { crc32, deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { isDateFormat, parseXml, readXlsx, serialToIso, unzip, workbookViolations } from './xlsx';

// Harness Mốc 5 (test-spec-hr-extended §1.2): bộ đọc .xlsx độc lập. Kiểm bằng workbook tự dựng ở đây — ZIP stream
// có data descriptor (đúng kiểu `fflate` Zip ghi) — vừa đúng mẫu ADR-130, vừa từng loại vi phạm.

interface Entry {
  name: string;
  data: string | Buffer;
  store?: boolean;
}

/** ZIP kiểu stream: cờ bit 3, local header CRC/size = 0, data descriptor sau dữ liệu. */
function zipStream(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const cen: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = e.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const method = e.store ? 0 : 8;
    const crc = crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x0808, 6); // bit 3 + UTF-8
    loc.writeUInt16LE(method, 8);
    loc.writeUInt16LE(name.length, 26);
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(crc, 4);
    dd.writeUInt32LE(comp.length, 8);
    dd.writeUInt32LE(raw.length, 12);
    parts.push(loc, name, comp, dd);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0808, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    cen.push(c, name);
    offset += 30 + name.length + comp.length + 16;
  }
  const cd = Buffer.concat(cen);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface BookOpts {
  sheets?: { name: string; body: string; state?: string }[];
  workbookExtra?: string;
  extraEntries?: Entry[];
  core?: string;
  cellXfs?: string;
  contentTypesExtra?: string;
}

/** Workbook đúng mẫu ADR-130: 2 sheet, style 0 chung, 1 quotePrefix, 2 ngày dd/mm/yyyy. */
function book(o: BookOpts = {}): Buffer {
  const sheets = o.sheets ?? [
    {
      name: 'Tổng hợp',
      body:
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Họ tên</t></is></c><c r="B1" t="inlineStr"><is><t>Công</t></is></c><c r="C1" t="inlineStr"><is><t>Ngày</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr" s="1"><is><t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;,&quot;y&quot;)</t></is></c><c r="B2"><v>21.5</v></c><c r="C2" s="2"><v>46310</v></c></row>' +
        '<row r="4"><c r="B4" t="inlineStr"><is><r><t>Nguyễn </t></r><r><t>Văn A 😀</t></r></is></c></row>',
    },
    { name: 'Theo ngày', body: '' },
  ];
  const wbSheets = sheets
    .map(
      (s, i) =>
        `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.state ? ` state="${s.state}"` : ''}/>`,
    )
    .join('');
  const rels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${RNS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('');
  return zipStream([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/>${o.contentTypesExtra ?? ''}</Types>`,
    },
    { name: '_rels/.rels', data: '<Relationships/>' },
    {
      name: 'docProps/core.xml',
      data:
        o.core ??
        '<cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>TaskFlow</dc:creator></cp:coreProperties>',
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${RNS}"><sheets>${wbSheets}</sheets>${o.workbookExtra ?? ''}</workbook>`,
    },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships>${rels}</Relationships>` },
    {
      name: 'xl/styles.xml',
      data: `<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs>${
        o.cellXfs ??
        '<xf numFmtId="0"/><xf numFmtId="0" quotePrefix="1"/><xf numFmtId="164" applyNumberFormat="1"/>'
      }</cellXfs></styleSheet>`,
    },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: `<worksheet xmlns="${NS}"><sheetData>${s.body}</sheetData></worksheet>`,
    })),
    ...(o.extraEntries ?? []),
  ]);
}

describe('unzip', () => {
  it('đọc ZIP stream (data descriptor) + stored; tên UTF-8; thứ tự central directory', () => {
    const entries = unzip(
      zipStream([
        { name: 'a.txt', data: 'xin chào' },
        { name: 'thư mục/b.bin', data: Buffer.from([0, 1, 2]), store: true },
      ]),
    );
    expect(entries.map((e) => [e.name, e.method])).toEqual([
      ['a.txt', 8],
      ['thư mục/b.bin', 0],
    ]);
    expect(entries[0]?.data.toString('utf8')).toBe('xin chào');
  });

  it('file cụt (zip bị cắt giữa chừng — XL-06) ⇒ ném lỗi, không trả nửa file', () => {
    const full = book();
    expect(() => unzip(full.subarray(0, Math.floor(full.length * 0.7)))).toThrow(/EOCD|hỏng/);
  });
});

describe('parseXml', () => {
  it('entity, CDATA, prefix, thẻ tự đóng', () => {
    const root = parseXml(
      '<?xml version="1.0"?><a:x k="1 &amp; 2"><b>&lt;&#65;&#x42;</b><c/><![CDATA[<z>]]></a:x>',
    );
    expect(root.name).toBe('a:x');
    expect(root.attrs['k']).toBe('1 & 2');
    expect(root.children.map((c) => [c.name, c.text])).toEqual([
      ['b', '<AB'],
      ['c', ''],
    ]);
    expect(root.text).toBe('<z>');
  });

  it.each([
    ['thẻ lệch', '<a><b></a></b>'],
    ['thiếu thẻ đóng', '<a><b></b>'],
    ['hai gốc', '<a/><b/>'],
    ['& trần', '<a>x & y</a>'],
    ['ký tự cấm U+0001', '<a>\u0001</a>'],
    ['tham chiếu ký tự cấm', '<a>&#1;</a>'],
    ['surrogate lẻ', '<a>\uD800x</a>'],
    ['U+FFFE', '<a>￾</a>'],
    ['DOCTYPE', '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'],
    ['thuộc tính lặp', '<a k="1" k="2"/>'],
  ])('%s ⇒ ném lỗi', (_, xml) => {
    expect(() => parseXml(xml)).toThrow();
  });
});

describe('readXlsx', () => {
  it('sheet theo thứ tự workbook, giá trị inlineStr (nối rich text) / số / ngày, style', () => {
    const wb = readXlsx(book());
    expect(wb.sheets.map((s) => s.name)).toEqual(['Tổng hợp', 'Theo ngày']);
    const s = wb.sheet('Tổng hợp');
    expect(s.rows).toEqual([
      ['Họ tên', 'Công', 'Ngày'],
      ['=HYPERLINK("http://x","y")', 21.5, 46310],
      [],
      [null, 'Nguyễn Văn A 😀'],
    ]);
    expect(s.cell('A2')).toMatchObject({ type: 'inlineStr', style: { quotePrefix: true } });
    const date = s.cell('C2');
    expect(date?.type).toBe('n');
    expect(isDateFormat(date?.style.formatCode)).toBe(true);
    expect(serialToIso(date?.value as number)).toBe('2026-10-15');
    expect(isDateFormat(s.cell('B2')?.style.formatCode)).toBe(false);
    expect(wb.core).toEqual({ creator: 'TaskFlow' });
    expect(wb.sheet('Theo ngày').cells).toEqual([]);
    expect(() => wb.sheet('Không có')).toThrow(/Tổng hợp, Theo ngày/);
  });

  it('workbook đúng mẫu ADR-130 ⇒ không vi phạm', () => {
    expect(workbookViolations(readXlsx(book()))).toEqual([]);
  });

  it('style s trỏ ra ngoài cellXfs ⇒ ném lỗi', () => {
    expect(() =>
      readXlsx(book({ sheets: [{ name: 'X', body: '<row><c r="A1" s="9"><v>1</v></c></row>' }] })),
    ).toThrow(/cellXfs/);
  });
});

describe('workbookViolations — mỗi loại vi phạm bị bắt', () => {
  const cell = (inner: string) => [{ name: 'X', body: `<row r="1">${inner}</row>` }];
  it.each<[string, BookOpts, RegExp]>([
    ['công thức', { sheets: cell('<c r="A1"><f>1+1</f><v>2</v></c>') }, /<f>|công thức/],
    [
      'sharedStrings',
      {
        sheets: cell('<c r="A1" t="s"><v>0</v></c>'),
        extraEntries: [{ name: 'xl/sharedStrings.xml', data: '<sst/>' }],
      },
      /sharedStrings|t="s"/,
    ],
    [
      'thiếu quotePrefix',
      { sheets: cell('<c r="A1" t="inlineStr"><is><t>@SUM(A1)</t></is></c>') },
      /quotePrefix/,
    ],
    [
      'TAB đầu thiếu quotePrefix',
      { sheets: cell('<c r="A1" t="inlineStr"><is><t>\t=1</t></is></c>') },
      /quotePrefix/,
    ],
    [
      "thêm dấu '",
      { sheets: cell('<c r="A1" t="inlineStr" s="1"><is><t>\'=1</t></is></c>') },
      /dấu '/,
    ],
    ['sheet ẩn', { sheets: [{ name: 'X', body: '', state: 'hidden' }] }, /state=hidden/],
    [
      'definedNames',
      { workbookExtra: '<definedNames><definedName name="x">X!A1</definedName></definedNames>' },
      /definedNames/,
    ],
    [
      'app.xml',
      { extraEntries: [{ name: 'docProps/app.xml', data: '<Properties/>' }] },
      /app\.xml/,
    ],
    [
      'lastModifiedBy',
      {
        core: '<cp:coreProperties xmlns:cp="x"><cp:lastModifiedBy>Ai đó</cp:lastModifiedBy></cp:coreProperties>',
      },
      /lastModifiedBy/,
    ],
    [
      'macro',
      { extraEntries: [{ name: 'xl/vbaProject.bin', data: Buffer.from([1]), store: true }] },
      /vbaProject/,
    ],
    [
      'externalLink',
      { extraEntries: [{ name: 'xl/externalLinks/externalLink1.xml', data: '<externalLink/>' }] },
      /externalLinks/,
    ],
    [
      'quan hệ External',
      {
        extraEntries: [
          {
            name: 'xl/worksheets/_rels/sheet1.xml.rels',
            data: '<Relationships><Relationship Id="r1" Target="http://x" TargetMode="External"/></Relationships>',
          },
        ],
      },
      /External/,
    ],
  ])('%s', (_, opts, re) => {
    expect(workbookViolations(readXlsx(book(opts))).join('\n')).toMatch(re);
  });

  it('hyperlink trong worksheet ⇒ vi phạm', () => {
    const buf = book();
    const wb = readXlsx(buf);
    const s = wb.sheets[0];
    if (!s) throw new Error('thiếu sheet');
    const tampered = s.xml.replace(
      '</worksheet>',
      '<hyperlinks><hyperlink ref="A2" r:id="x"/></hyperlinks></worksheet>',
    );
    const root = parseXml(tampered);
    expect(
      workbookViolations({ ...wb, sheets: [{ ...s, xml: tampered, root }] }).join('\n'),
    ).toMatch(/hyperlink/);
  });
});

describe('isDateFormat / serialToIso', () => {
  it.each([
    ['dd/mm/yyyy', true],
    ['mm-dd-yy', true],
    ['h:mm', true],
    ['[Red]0.00', false],
    ['"ngày"0', false],
    ['#,##0.0', false],
    ['General', false],
  ])('%s ⇒ %s', (code, want) => {
    expect(isDateFormat(code)).toBe(want);
  });
  it('serial ⇒ ISO (hệ 1900)', () => {
    expect(serialToIso(45658)).toBe('2025-01-01');
    expect(serialToIso(46387)).toBe('2026-12-31');
    expect(serialToIso(46022.75)).toBe('2025-12-31T18:00:00');
  });
});
