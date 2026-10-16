import { describe, expect, it } from 'vitest';

import {
  createAttendanceHarness,
  HANA,
  key,
  MAX,
  MIA,
  vnTime,
  W1,
} from '../../testing/attendance-harness';
import { csvCell, csvRow } from '../csv';
import { AttendanceExportUseCase } from './attendance-export.use-case';

// test-spec-hr §5/§8: xuất CSV — SEC-HR-11 (injection), SEC-HR-12 (không IP/UA, BOM), SEC-HR-13 (audit), AT-23.
const setup = createAttendanceHarness;
const read = async (lines: AsyncGenerator<string>) => {
  let out = '';
  for await (const chunk of lines) out += chunk;
  return out;
};
/** Tách CSV đã bọc `"` (không có xuống dòng trong ô). */
const parse = (csv: string) =>
  csv
    .replace(/^\uFEFF/, '')
    .split('\r\n')
    .filter(Boolean)
    .map((line) =>
      line
        .slice(1, -1)
        .split('","')
        .map((c) => c.replaceAll('""', '"')),
    );

describe('csvCell', () => {
  it('SEC-HR-11 ô CHỮ bắt đầu bằng = + - @ \\t \\r ⇒ tiền tố \'; mọi ô bọc "; " nhân đôi; ô raw giữ nguyên', () => {
    for (const bad of [
      '=1+1',
      '+84',
      '-2',
      '@SUM(A1)',
      '\tx',
      '\rx',
      '\nx',
      '\uFF1D1+1',
      '\uFF0B84',
      '\uFF0D2',
      '\uFF20SUM(A1)',
    ]) {
      expect(csvCell(bad, 'text')).toBe(`"'${bad}"`);
    }
    expect(csvCell('Mia "Ngọc"', 'text')).toBe('"Mia ""Ngọc"""');
    expect(csvCell('a=b', 'text')).toBe('"a=b"');
    expect(csvCell('-5')).toBe('"-5"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvRow(['"a"', '"b"'])).toBe('"a","b"\r\n');
  });
});

describe('AttendanceExportUseCase', () => {
  it('BOM + tiêu đề, mỗi người × mỗi ngày một dòng, KHÔNG có IP/UA; audit EXPORT (tháng + số dòng) trước khi stream', async () => {
    const t = await setup('2026-11-17 18:00');
    await t.punch('IN', key(1));
    const { rows, lines } = await t.exportUseCase.start(W1, HANA, '2026-11');
    expect(rows).toBe(4 * 30);
    expect(t.audit).toEqual([
      expect.objectContaining({
        action: 'EXPORT',
        actorId: HANA,
        after: { kind: 'attendance_month', month: '2026-11', rows: 120 },
      }),
    ]);
    const csv = await read(lines);
    expect(csv.startsWith('\uFEFF"Họ tên",')).toBe(true);
    const table = parse(csv);
    expect(table).toHaveLength(1 + 120);
    expect(table[0]).toEqual([
      'Họ tên',
      'Đã nghỉ việc',
      'Ngày',
      'Thứ',
      'Trạng thái',
      'Giờ vào',
      'Giờ ra',
      'Phút làm',
      'Đi muộn (phút)',
      'Về sớm (phút)',
      'Nghỉ phép',
      'Ngày lễ',
    ]);
    expect(csv).not.toMatch(/203\.0\.113\.7|Mozilla/);
    const mia17 = table.find((r) => r[0] === 'Mia' && r[2] === '2026-11-17')!;
    expect(mia17).toEqual([
      'Mia',
      '',
      '2026-11-17',
      'T3',
      'Thiếu giờ ra',
      '18:00',
      '',
      '0',
      '570',
      '0',
      '',
      '',
    ]);
  });

  it('AT-23 ngày ngoài nhiệm kỳ ⇒ "Chưa/không còn làm" + số 0; người đã rời gắn "Có"; OUT sau nửa đêm ⇒ "(+1)"', async () => {
    const t = await setup('2026-11-30 20:00');
    t.tenures.rows.splice(
      t.tenures.rows.findIndex((r) => r.userId === MAX),
      1,
      {
        workspaceId: W1,
        userId: MAX,
        from: vnTime('2020-01-01 09:00'),
        until: vnTime('2026-11-20 17:00'),
      },
    );
    await t.eventUseCases.adjust(W1, HANA, {
      userId: MIA,
      kind: 'IN',
      date: '2026-11-16',
      time: '08:00',
      nextDay: false,
      reason: 'x',
    });
    await t.eventUseCases.adjust(W1, HANA, {
      userId: MIA,
      kind: 'OUT',
      date: '2026-11-16',
      time: '00:30',
      nextDay: true,
      reason: 'x',
    });
    const table = parse(await read((await t.exportUseCase.start(W1, HANA, '2026-11')).lines));
    expect(table.find((r) => r[0] === 'Max' && r[2] === '2026-11-21')).toEqual([
      'Max',
      'Có',
      '2026-11-21',
      'T7',
      'Chưa/không còn làm',
      '',
      '',
      '0',
      '0',
      '0',
      '',
      '',
    ]);
    expect(table.find((r) => r[0] === 'Mia' && r[2] === '2026-11-16')!.slice(4, 8)).toEqual([
      'Có mặt',
      '08:00',
      '00:30 (+1)',
      '480',
    ]);
  });

  it('SEC-HR-11 họ tên / tên ngày lễ bắt đầu bằng "=" ⇒ ô có tiền tố \'; ngày / số giữ nguyên', async () => {
    const t = await setup('2026-11-17 10:00');
    await t.backend.addHoliday(W1, '2026-11-02', '=HYPERLINK("http://x")');
    const exporter = new AttendanceExportUseCase({
      ...t.deps,
      ...t.collaborators,
      users: {
        findRefs: (ids) =>
          Promise.resolve(
            new Map(ids.map((id) => [id, { id, fullName: `=cmd|' /C calc'!A0 ${id.slice(-2)}` }])),
          ),
      },
    });
    const csv = await read((await exporter.start(W1, HANA, '2026-11')).lines);
    const table = parse(csv);
    expect(table.slice(1).every((r) => r[0]!.startsWith("'=cmd|"))).toBe(true);
    expect(table.find((r) => r[2] === '2026-11-02')![11]).toBe('\'=HYPERLINK("http://x")');
    expect(table[1]![2]).toMatch(/^2026-11-\d\d$/);
  });

  it('không phải thành viên / mất quyền ⇒ lỗi TRƯỚC khi có byte nào, không audit', async () => {
    const t = await setup();
    t.members.delete(HANA);
    await expect(t.exportUseCase.start(W1, HANA, '2026-11')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(t.audit).toEqual([]);
  });
});
