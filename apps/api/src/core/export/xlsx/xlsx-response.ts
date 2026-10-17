import type { Response } from 'express';

import type { ISpreadsheetWriter, SpreadsheetSheet } from './xlsx-writer';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Tên file an toàn cho header: chỉ [A-Za-z0-9._-] (bên gọi dựng từ giá trị đã validate — vd năm, tháng). */
const SAFE_FILENAME = /^[A-Za-z0-9._-]{1,100}\.xlsx$/;

/**
 * Gửi .xlsx theo luồng (ADR-130, B-review F): quyền / validate / 422 / audit EXPORT phải xong TRƯỚC khi gọi hàm này
 * (lỗi lúc đó vẫn là envelope JSON). Sau khi header đã gửi, lỗi giữa chừng KHÔNG được trả 200 với file cụt ⇒ hủy kết
 * nối (`socket.destroy()`) để trình duyệt báo tải thất bại, rồi ném tiếp cho logger.
 */
export async function sendXlsx(
  res: Response,
  writer: ISpreadsheetWriter,
  filename: string,
  sheets: readonly SpreadsheetSheet[],
): Promise<void> {
  if (!SAFE_FILENAME.test(filename)) throw new Error(`xlsx: tên file không an toàn: ${filename}`);
  res.status(200).set({
    'Content-Type': XLSX_CONTENT_TYPE,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  try {
    await writer.write(sheets, (chunk) => {
      if (res.write(chunk)) return;
      return new Promise<void>((resolve, reject) => {
        const onDrain = () => {
          res.off('close', onClose);
          resolve();
        };
        const onClose = () => {
          res.off('drain', onDrain);
          reject(new Error('xlsx: client đóng kết nối'));
        };
        res.once('drain', onDrain);
        res.once('close', onClose);
      });
    });
    res.end();
  } catch (err) {
    res.socket?.destroy();
    throw err;
  }
}
