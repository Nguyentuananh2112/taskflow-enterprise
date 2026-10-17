import express from 'express';
import { strFromU8, unzipSync } from 'fflate';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import {
  cellXml,
  columnName,
  escapeXml,
  needsQuotePrefix,
  sheetName,
  stripXmlForbidden,
} from './xlsx-cells';
import { XLSX_CONTENT_TYPE, sendXlsx } from './xlsx-response';
import { FflateXlsxWriter, type SpreadsheetSheet } from './xlsx-writer';

// ADR-130 + luật của B (T-055x): không bao giờ `<f>`, inline string, escape 5 ký tự, bỏ ký tự XML 1.0 cấm + surrogate
// lẻ, quotePrefix cho = + - @ TAB CR, lỗi giữa chừng ⇒ hủy kết nối. `unzipSync` CHỈ dùng trong test để đọc ngược.

async function build(sheets: SpreadsheetSheet[]): Promise<Record<string, string>> {
  const parts: Uint8Array[] = [];
  await new FflateXlsxWriter().write(sheets, (c) => {
    parts.push(c);
  });
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return Object.fromEntries(Object.entries(unzipSync(all)).map(([k, v]) => [k, strFromU8(v)]));
}

describe('xlsx-cells (thuần)', () => {
  it('quotePrefix cho = + - @ TAB CR ở đầu; không cho ở giữa / chuỗi rỗng', () => {
    for (const s of ['=cmd|"/c calc"!A1', '+1', '-2', '@SUM(A1)', '\tx', '\rx']) {
      expect(needsQuotePrefix(s), JSON.stringify(s)).toBe(true);
    }
    for (const s of ['a=b', '1+1', '', ' =x', 'Nguyễn']) expect(needsQuotePrefix(s)).toBe(false);
  });

  it('bỏ ký tự XML 1.0 cấm và surrogate lẻ, giữ TAB/LF/CR và cặp surrogate hợp lệ', () => {
    const bad = 'a\u0000b\u0008c\u000Bd\u000Ce\u000Ef\u001Fg￾h￿i\uD800j\uDC00k';
    expect(stripXmlForbidden(bad)).toBe('abcdefghijk');
    expect(stripXmlForbidden('x\ty\nz\rw😀')).toBe('x\ty\nz\rw😀');
  });

  it('escape đủ 5 ký tự; tên cột; ô số / null / rỗng', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;',
    );
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(cellXml('A1', 12.5)).toBe('<c r="A1"><v>12.5</v></c>');
    expect(cellXml('A1', null)).toBe('');
    expect(cellXml('A1', '\u0000\u0001')).toBe('');
    expect(() => cellXml('A1', Number.NaN)).toThrow();
    expect(() => cellXml('A1', Number.POSITIVE_INFINITY)).toThrow();
  });

  it('tên sheet: bỏ ký tự cấm, ≤ 31, không rỗng, trùng ⇒ hậu tố', () => {
    const used = new Set<string>();
    expect(sheetName('Phép [2026]: tổng/hợp?', used)).toBe('Phép  2026   tổng hợp');
    expect(sheetName("'x'", used)).toBe('x');
    expect(sheetName('', used)).toBe('Sheet');
    expect(sheetName('a'.repeat(40), used)).toHaveLength(31);
    expect(sheetName('X', used)).toBe('X (2)');
  });
});

describe('FflateXlsxWriter', () => {
  it('gói hợp lệ: đủ part, không có <f>, ô nguy hiểm có quotePrefix (s="1"), ký tự cấm bị bỏ, escape', async () => {
    const files = await build([
      {
        name: 'Phép',
        columns: [{ header: 'Tên', width: 30 }, { header: 'Ngày' }, { header: 'Ghi chú' }],
        rows: [
          ['=cmd|"/c calc"!A1', 12.5, '<b>&amp;</b>'],
          ['@SUM(A1)', null, 'a\u0000b\uD800c'],
          ['Nguyễn Văn A', 0, '\tTAB'],
        ],
      },
    ]);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = files['xl/worksheets/sheet1.xml']!;
    for (const xml of Object.values(files)) expect(xml).not.toMatch(/<f[\s>]/);
    expect(sheet).toContain(
      '<c r="A2" t="inlineStr" s="1"><is><t xml:space="preserve">=cmd|&quot;/c calc&quot;!A1</t></is></c>',
    );
    expect(sheet).toContain('<c r="A3" t="inlineStr" s="1">');
    expect(sheet).toContain('<c r="C4" t="inlineStr" s="1">');
    expect(sheet).toContain('&lt;b&gt;&amp;amp;&lt;/b&gt;');
    expect(sheet).toContain('<t xml:space="preserve">abc</t>');
    expect(sheet).toContain('<c r="B2"><v>12.5</v></c>');
    expect(sheet).not.toContain('r="B3"');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="2">'); // tiêu đề đậm
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(files['xl/styles.xml']).toContain('quotePrefix="1"');
    expect(files['xl/workbook.xml']).toContain('<sheet name="Phép" sheetId="1" r:id="rId1"/>');
  });

  it('nhiều sheet + hàng async qua nhiều lô (> 64 KB) vẫn đúng thứ tự', async () => {
    async function* many() {
      for (let i = 0; i < 5_000; i++) {
        if (i % 1_000 === 0) await Promise.resolve(); // như đọc DB theo lô
        yield [`Người ${String(i)}`, i] as const;
      }
    }
    const files = await build([
      { name: 'A', columns: [{ header: 'Tên' }, { header: 'Số' }], rows: many() },
      { name: 'A', columns: [{ header: 'X' }], rows: [] },
    ]);
    const s1 = files['xl/worksheets/sheet1.xml']!;
    expect(s1.match(/<row /g)).toHaveLength(5_001);
    expect(s1).toContain('<c r="B5001"><v>4999</v></c>');
    expect(s1.endsWith('</sheetData></worksheet>')).toBe(true);
    expect(files['xl/workbook.xml']).toContain('name="A (2)"');
  });

  it('hàng nhiều ô hơn số cột / không có sheet ⇒ lỗi', async () => {
    await expect(
      build([{ name: 'A', columns: [{ header: 'x' }], rows: [['a', 'b']] }]),
    ).rejects.toThrow(/số cột/);
    await expect(build([])).rejects.toThrow(/ít nhất một sheet/);
  });
});

describe('sendXlsx', () => {
  const app = (rows: SpreadsheetSheet['rows'], filename = 'nghi-phep-2026.xlsx') => {
    const a = express();
    a.get('/x', async (_req, res, next) => {
      try {
        await sendXlsx(res, new FflateXlsxWriter(), filename, [
          { name: 'S', columns: [{ header: 'a' }], rows },
        ]);
      } catch (err) {
        next(err);
      }
    });
    return a;
  };

  it('200 + header đúng (attachment, no-store, nosniff, content-type xlsx)', async () => {
    const res = await request(app([['x']]))
      .get('/x')
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe(XLSX_CONTENT_TYPE);
    expect(res.headers['content-disposition']).toBe('attachment; filename="nghi-phep-2026.xlsx"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const files = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml');
  });

  it('lỗi giữa chừng (sau khi đã gửi header) ⇒ hủy kết nối, không trả file cụt như thành công', async () => {
    async function* broken() {
      for (let i = 0; i < 6_000; i++) {
        if (i % 1_000 === 0) await Promise.resolve();
        yield [`r${String(i)}`];
      }
      throw new Error('DB mất kết nối giữa chừng');
    }
    await expect(request(app(broken())).get('/x')).rejects.toThrow(
      /socket hang up|aborted|ECONNRESET/,
    );
  });

  it('tên file không an toàn ⇒ từ chối trước khi gửi header', async () => {
    const res = await request(app([['x']], 'a"b.xlsx')).get('/x');
    expect(res.status).toBe(500);
  });
});
