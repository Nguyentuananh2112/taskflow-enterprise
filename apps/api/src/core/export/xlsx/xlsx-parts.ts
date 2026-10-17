import { escapeXml } from './xlsx-cells';

// Các phần XML cố định của một gói .xlsx tối thiểu (SpreadsheetML, ECMA-376) — ADR-130. Không sharedStrings, không
// theme, không công thức, không macro. Style: 0 thường · 1 quotePrefix · 2 tiêu đề đậm · 3 tiêu đề đậm + quotePrefix
// · 4 ngày `dd/mm/yyyy` (numFmt tự định nghĩa 164) — khớp `STYLE` của xlsx-cells.

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${String(i + 1)}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    `${sheets}</Types>`
  );
}

export const ROOT_RELS_XML =
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  `<Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="xl/workbook.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

/**
 * Thuộc tính tài liệu TỐI THIỂU (F SEC-HR-54): chỉ `creator = TaskFlow`. Không `docProps/app.xml`, không
 * `lastModifiedBy`, `Company`, `Manager`, ngày tạo — file không mang thông tin người xuất / máy chủ.
 */
export const CORE_PROPS_XML =
  `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  'xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>TaskFlow</dc:creator></cp:coreProperties>';

export function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map(
      (name, i) =>
        `<sheet name="${escapeXml(name)}" sheetId="${String(i + 1)}" r:id="rId${String(i + 1)}"/>`,
    )
    .join('');
  return `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets}</sheets></workbook>`;
}

export function workbookRelsXml(sheetCount: number): string {
  const rels = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Relationship Id="rId${String(i + 1)}" Type="${REL_TYPE}/worksheet" Target="worksheets/sheet${String(i + 1)}.xml"/>`,
  ).join('');
  const styles = `<Relationship Id="rId${String(sheetCount + 1)}" Type="${REL_TYPE}/styles" Target="styles.xml"/>`;
  return `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels}${styles}</Relationships>`;
}

export const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs></styleSheet>';

/** Phần đầu worksheet: cố định hàng tiêu đề + độ rộng cột (ký tự). */
export function sheetHeadXml(widths: readonly (number | undefined)[]): string {
  const cols = widths
    .map((w, i) =>
      w === undefined
        ? ''
        : `<col min="${String(i + 1)}" max="${String(i + 1)}" width="${String(w)}" customWidth="1"/>`,
    )
    .join('');
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}">` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    (cols === '' ? '' : `<cols>${cols}</cols>`) +
    '<sheetData>'
  );
}

export const SHEET_TAIL_XML = '</sheetData></worksheet>';
