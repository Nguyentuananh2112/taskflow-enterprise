import { Zip, ZipDeflate, strToU8 } from 'fflate';

import { rowXml, sheetName, type CellValue } from './xlsx-cells';
import {
  ROOT_RELS_XML,
  SHEET_TAIL_XML,
  STYLES_XML,
  contentTypesXml,
  sheetHeadXml,
  workbookRelsXml,
  workbookXml,
} from './xlsx-parts';

// Bộ ghi .xlsx tối thiểu tự viết trên fflate (ADR-130; B duyệt chuỗi cung ứng 17/10). Chỉ NÉN (Zip/ZipDeflate +
// strToU8) — không bao giờ giải nén dữ liệu người dùng (giới hạn bề mặt zip-bomb). File DUY NHẤT được import fflate
// (luật depcruise `xlsx-only-fflate`). Ghi theo lô ra `sink` ⇒ không giữ cả bảng trong bộ nhớ.

export type { CellValue } from './xlsx-cells';

export interface SpreadsheetColumn {
  header: string;
  /** Độ rộng theo số ký tự (Excel); bỏ trống ⇒ mặc định. */
  width?: number;
}

export interface SpreadsheetSheet {
  name: string;
  columns: readonly SpreadsheetColumn[];
  /** Hàng dữ liệu (không gồm tiêu đề); có thể async để đọc DB theo lô. */
  rows: Iterable<readonly CellValue[]> | AsyncIterable<readonly CellValue[]>;
}

/**
 * Port xuất bảng tính (ADR-130). `sink` nhận từng mảnh của file theo thứ tự; trả promise ⇒ writer chờ (backpressure).
 * Lỗi giữa chừng ⇒ promise reject — bên HTTP phải hủy kết nối (`socket.destroy()`), không gửi file cụt như hợp lệ.
 */
export interface ISpreadsheetWriter {
  write(
    sheets: readonly SpreadsheetSheet[],
    sink: (chunk: Uint8Array) => void | Promise<void>,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
}

/** Trần hàng của một sheet trong Excel (gồm hàng tiêu đề) — vượt ⇒ ném lỗi, không xuất file hỏng (B L3). */
export const XLSX_MAX_ROWS = 1_048_576;

/** Gom XML hàng tới ngưỡng này rồi mới nén một mảnh (ít lần gọi fflate, bộ nhớ chặn trên). */
const BATCH_CHARS = 64 * 1024;

export class FflateXlsxWriter implements ISpreadsheetWriter {
  async write(
    sheets: readonly SpreadsheetSheet[],
    sink: (chunk: Uint8Array) => void | Promise<void>,
    opts: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const stopIfAborted = () => {
      if (opts.signal?.aborted) throw new Error('xlsx: đã hủy (client đóng kết nối)');
    };
    if (sheets.length === 0) throw new Error('xlsx: cần ít nhất một sheet');
    const pending: Uint8Array[] = [];
    let failure: Error | null = null;
    const zip = new Zip((err, data) => {
      if (err) failure ??= err;
      else pending.push(data);
    });
    const flush = async () => {
      if (failure) throw failure;
      while (pending.length > 0) await sink(pending.shift()!);
    };
    const addWhole = async (path: string, xml: string) => {
      const file = new ZipDeflate(path, { level: 6 });
      zip.add(file);
      file.push(strToU8(xml), true);
      await flush();
    };

    const used = new Set<string>();
    const names = sheets.map((s) => sheetName(s.name, used));
    await addWhole('[Content_Types].xml', contentTypesXml(sheets.length));
    await addWhole('_rels/.rels', ROOT_RELS_XML);
    await addWhole('xl/workbook.xml', workbookXml(names));
    await addWhole('xl/_rels/workbook.xml.rels', workbookRelsXml(sheets.length));
    await addWhole('xl/styles.xml', STYLES_XML);

    for (const [i, sheet] of sheets.entries()) {
      const file = new ZipDeflate(`xl/worksheets/sheet${String(i + 1)}.xml`, { level: 6 });
      zip.add(file);
      let buf =
        sheetHeadXml(sheet.columns.map((c) => c.width)) +
        rowXml(
          1,
          sheet.columns.map((c) => c.header),
          true,
        );
      let row = 1;
      for await (const values of sheet.rows) {
        // B M1: client đã đóng ⇒ ngừng kéo hàng NGAY (không đọc DB / nén tiếp vào socket chết).
        stopIfAborted();
        if (row >= XLSX_MAX_ROWS)
          throw new Error(`xlsx: sheet "${sheet.name}" vượt ${String(XLSX_MAX_ROWS)} hàng`);
        if (values.length > sheet.columns.length) {
          throw new Error(`xlsx: hàng ${String(row + 1)} có ${String(values.length)} ô > số cột`);
        }
        row += 1;
        buf += rowXml(row, values);
        if (buf.length >= BATCH_CHARS) {
          file.push(strToU8(buf));
          buf = '';
          await flush();
        }
      }
      file.push(strToU8(buf + SHEET_TAIL_XML), true);
      await flush();
    }
    zip.end();
    await flush();
  }
}
