import { describe, expect, it } from 'vitest';

import {
  bufferSource,
  inspectZip,
  matchOfficeType,
  sniffType,
  SNIFF_HEAD_BYTES,
  type FileType,
} from '../../src/core/files/domain';
import * as fx from '../security/harness/files/fixtures';

/**
 * CH-03 đối chiếu với tệp mẫu của F (test-spec-chat §1.2 — một ca cho mỗi hàm sinh): cùng bộ byte mà
 * suite hộp đen gửi lên phải được domain phân loại đúng. Ảnh hỏng / pixel bomb qua sniff (magic đúng)
 * — bị chặn ở bước sharp `metadata()` (T-067 bước 4, SEC-CH-08/33).
 */
type Verdict = FileType | 'UNSUPPORTED_FILE_TYPE' | 'MACRO_OR_ACTIVE_CONTENT';

async function classify(buf: Buffer, ext: string): Promise<Verdict> {
  const head = buf.subarray(0, SNIFF_HEAD_BYTES);
  const sniffed = sniffType(head, ext, head.length === buf.length);
  if (!sniffed.ok) return sniffed.reason;
  if (sniffed.type !== 'zip') return sniffed.type;
  const zip = await inspectZip(bufferSource(buf));
  if (!zip.ok) return zip.reason;
  return matchOfficeType(zip.type, ext) ? zip.type : 'UNSUPPORTED_FILE_TYPE';
}

const U = 'UNSUPPORTED_FILE_TYPE';
const M = 'MACRO_OR_ACTIVE_CONTENT';

describe('CH-03 × fixtures của F', () => {
  it.each<[string, () => Buffer, string, Verdict]>([
    ['png()', () => fx.png({ w: 4, h: 4 }), 'png', 'png'],
    ['jpeg()', () => fx.jpeg(), 'jpg', 'jpeg'],
    ['jpegWithGps()', () => fx.jpegWithGps(), 'jpeg', 'jpeg'],
    ['webp()', () => fx.webp(), 'webp', 'webp'],
    ['gif()', () => fx.gif(), 'gif', 'gif'],
    ['gifJsPolyglot()', () => fx.gifJsPolyglot(), 'gif', 'gif'],
    ['pixelBombPng() — chặn ở sharp', () => fx.pixelBombPng(), 'png', 'png'],
    ['pngMagicButCorrupt() — chặn ở sharp', () => fx.pngMagicButCorrupt(), 'png', 'png'],
    ['tiff() đổi tên .jpg', () => fx.tiff(), 'jpg', U],
    ['html()', () => fx.html(), 'html', U],
    ['html() đổi tên .txt là TXT', () => fx.html(), 'txt', 'txt'],
    ['svgScript()', () => fx.svgScript(), 'svg', U],
    ['svgScript() đổi tên .jpg', () => fx.svgScript(), 'jpg', U],
    ['xml()', () => fx.xml(), 'xml', U],
    ['js()', () => fx.js(), 'js', U],
    ['exeMz() đổi tên .pdf', () => fx.exeMz(), 'pdf', U],
    ['elf()', () => fx.elf(), 'txt', U],
    ['machO()', () => fx.machO(), 'pdf', U],
    ['shebang() đổi tên .txt', () => fx.shebang(), 'txt', U],
    ['rar()', () => fx.rar(), 'rar', U],
    ['sevenZ()', () => fx.sevenZ(), '7z', U],
    ['gz()', () => fx.gz(), 'gz', U],
    ['mp4()', () => fx.mp4(), 'mp4', U],
    ['plainZip()', () => fx.plainZip(), 'zip', U],
    ['plainZip() đổi tên .docx', () => fx.plainZip(), 'docx', U],
    ['png() đổi tên .exe', () => fx.png({ w: 2, h: 2 }), 'exe', U],
    ['pdf()', () => fx.pdf(), 'pdf', 'pdf'],
    ['bytes(20 MB) — PDF', () => fx.bytes(1024 * 1024), 'pdf', 'pdf'],
    ['textWithNul()', () => fx.textWithNul(), 'txt', U],
    ['csv(utf8)', () => fx.csv('utf8'), 'csv', 'csv'],
    ['csv(utf8bom)', () => fx.csv('utf8bom'), 'csv', 'csv'],
    ['csv(utf16le)', () => fx.csv('utf16le'), 'csv', 'csv'],
    ['csv(utf16be)', () => fx.csv('utf16be'), 'csv', 'csv'],
    ['csv(win1258)', () => fx.csv('win1258'), 'csv', 'csv'],
    ['ooxml(docx)', () => fx.ooxml('docx'), 'docx', 'docx'],
    ['ooxml(xlsx)', () => fx.ooxml('xlsx'), 'xlsx', 'xlsx'],
    ['ooxml(pptx)', () => fx.ooxml('pptx'), 'pptx', 'pptx'],
    [
      'ooxml(docx, contentTypesLast)',
      () => fx.ooxml('docx', { contentTypesLast: true }),
      'docx',
      'docx',
    ],
    ['ooxml(xlsx) đổi tên .docx', () => fx.ooxml('xlsx'), 'docx', U],
    ['ooxml(docx, vbaProject)', () => fx.ooxml('docx', { vbaProject: true }), 'docx', M],
    [
      'ooxml(docx, macroEnabledType) — .docm đổi .docx',
      () => fx.ooxml('docx', { macroEnabledType: true }),
      'docx',
      M,
    ],
    ['ooxml(xlsx, externalLink)', () => fx.ooxml('xlsx', { externalLink: true }), 'xlsx', M],
    ['ooxml(docx, oleObject)', () => fx.ooxml('docx', { oleObject: true }), 'docx', M],
    ['odf(odt)', () => fx.odf('odt'), 'odt', 'odt'],
    ['odf(ods)', () => fx.odf('ods'), 'ods', 'ods'],
    ['odf(odt, basic)', () => fx.odf('odt', { basic: true }), 'odt', M],
    ['odf(ods, scripts)', () => fx.odf('ods', { scripts: true }), 'ods', M],
    ['bigOoxml(2001)', () => fx.bigOoxml(2001), 'docx', U],
  ])('%s .%s ⇒ %s', async (_name, make, ext, expected) => {
    expect(await classify(make(), ext)).toBe(expected);
  });
});
