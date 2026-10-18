import { deflateRawSync } from 'node:zlib';

/**
 * Dựng ZIP tối thiểu trong test (local header + central directory + EOCD) — không commit nhị phân,
 * không thêm dependency (test-spec-chat §1.2). `order` của mảng = thứ tự entry trên đĩa.
 */
export interface ZipEntryInput {
  name: string;
  data: string | Uint8Array;
  /** Mặc định STORED. */
  deflate?: boolean;
}

export function buildZip(
  entries: readonly ZipEntryInput[],
  options: { comment?: string } = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data);
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const method = e.deflate ? 8 : 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 names
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(0, 14); // crc — không kiểm
    lfh.writeUInt32LE(body.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    locals.push(lfh, name, body);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(body.length, 20);
    cdh.writeUInt32LE(raw.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt32LE(offset, 42);
    centrals.push(cdh, name);

    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...locals, cd, eocd, comment]);
}

const OOXML_CT: Record<'docx' | 'xlsx' | 'pptx', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
};

export function contentTypesXml(mainType: string, extra = ''): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    `<Override PartName="/main.xml" ContentType="${mainType}"/>${extra}</Types>`
  );
}

export function ooxml(
  kind: 'docx' | 'xlsx' | 'pptx',
  opts: {
    extraEntries?: ZipEntryInput[];
    ctExtra?: string;
    contentTypesLast?: boolean;
    deflate?: boolean;
  } = {},
): Buffer {
  const ct: ZipEntryInput = {
    name: '[Content_Types].xml',
    data: contentTypesXml(OOXML_CT[kind], opts.ctExtra),
    deflate: opts.deflate ?? true,
  };
  const body: ZipEntryInput[] = [
    { name: '_rels/.rels', data: '<Relationships/>' },
    { name: 'main.xml', data: '<doc/>' },
    ...(opts.extraEntries ?? []),
  ];
  return buildZip(opts.contentTypesLast ? [...body, ct] : [ct, ...body]);
}

export function odf(
  mime: string,
  opts: { extraEntries?: ZipEntryInput[]; manifest?: string } = {},
): Buffer {
  return buildZip([
    { name: 'mimetype', data: mime },
    { name: 'content.xml', data: '<office:document-content/>', deflate: true },
    ...(opts.manifest
      ? [{ name: 'META-INF/manifest.xml', data: opts.manifest, deflate: true }]
      : []),
    ...(opts.extraEntries ?? []),
  ]);
}
