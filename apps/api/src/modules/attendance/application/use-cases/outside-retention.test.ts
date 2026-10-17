import { AttendanceMonthDto } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

import {
  createAttendanceHarness,
  HANA,
  key,
  MIA,
  OLIVIA,
  W1,
} from '../../testing/attendance-harness';

// T-047 (TL d9, R27): ngày công `< mốc lưu` của job retention ĐANG BẬT đã / sẽ bị xóa ⇒ bảng công hiện
// RETENTION_EXPIRED (không giả "Vắng"), lệnh ghi ⇒ 422 OUTSIDE_RETENTION. Job TẮT (mốc null — local/test mặc định)
// ⇒ dữ liệu cũ còn nguyên ⇒ mọi thứ như thường.

const setup = createAttendanceHarness;
const CUTOFF = '2026-11-10';
const adjustBody = (date: string) => ({
  userId: MIA,
  kind: 'IN' as const,
  date,
  time: '08:00',
  nextDay: false,
  reason: 'Nhập bù',
});
const outside = { statusCode: 422, details: { rule: 'OUTSIDE_RETENTION' } };

describe('bảng công khi job retention BẬT (mốc 10/11)', () => {
  it('ngày < mốc ⇒ RETENTION_EXPIRED, không giờ / phép / phút; tổng tháng tính 0 cho ngày đó; ngày ≥ mốc như thường', async () => {
    const t = await setup('2026-11-17 20:00');
    await t.eventUseCases.adjust(W1, HANA, adjustBody('2026-11-09')); // lượt cũ còn trong DB (job chưa chạy tới)
    t.leaves.rows.push({ workspaceId: W1, userId: MIA, date: '2026-11-05', part: 'FULL' });
    t.retention.cutoff = CUTOFF;
    const month = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(AttendanceMonthDto.parse(month)).toEqual(month);
    const of = (date: string) => month.days.find((d) => d.date === date)!;
    for (const date of ['2026-11-01', '2026-11-05', '2026-11-09']) {
      expect(of(date)).toMatchObject({
        status: 'RETENTION_EXPIRED',
        firstIn: null,
        lastOut: null,
        workedMin: 0,
        leave: null,
        late: false,
      });
    }
    expect(of('2026-11-10').status).toBe('ABSENT');
    // 10..17/11: 15/11 CN ⇒ 7 ngày công vắng; KHÔNG đếm vắng / phép / đi làm của 1..9/11.
    expect(month.totals).toMatchObject({
      absentDays: 7,
      leaveDays: 0,
      presentDays: 0,
      throughDate: '2026-11-17',
    });
  });

  it('bảng HR cùng quy tắc (cùng summarize + totals)', async () => {
    const t = await setup('2026-11-17 20:00');
    t.retention.cutoff = CUTOFF;
    const r = await t.hrQueries.month(W1, { month: '2026-11', limit: 50 });
    const mia = r.data.find((x) => x.user.id === MIA)!;
    expect(mia.days.filter((d) => d.status === 'RETENTION_EXPIRED')).toHaveLength(9);
    expect(mia.totals.absentDays).toBe(7);
  });
});

describe('lệnh ghi ngoài thời hạn lưu (job BẬT) ⇒ 422 OUTSIDE_RETENTION', () => {
  it('ADJUSTMENT cho ngày < mốc ⇒ 422, không ghi; đúng ngày mốc ⇒ được', async () => {
    const t = await setup('2026-11-17 10:00');
    t.retention.cutoff = CUTOFF;
    await expect(t.eventUseCases.adjust(W1, HANA, adjustBody('2026-11-09'))).rejects.toMatchObject(
      outside,
    );
    expect(await t.backend.eventRows()).toHaveLength(0);
    await expect(t.eventUseCases.adjust(W1, HANA, adjustBody(CUTOFF))).resolves.toBeDefined();
  });

  it('thứ tự lỗi: người không phải nhân viên + ngày < mốc ⇒ 404 user (TRƯỚC 422 OUTSIDE_RETENTION)', async () => {
    const t = await setup('2026-11-17 10:00');
    t.retention.cutoff = CUTOFF;
    t.members.delete(MIA);
    await expect(t.eventUseCases.adjust(W1, HANA, adjustBody('2026-11-09'))).rejects.toMatchObject({
      statusCode: 404,
      details: { resource: 'user' },
    });
  });

  it('void lượt có workDate < mốc ⇒ 422, lượt không bị hủy', async () => {
    const t = await setup('2026-11-17 10:00');
    const r = await t.eventUseCases.adjust(W1, HANA, adjustBody('2026-11-09'));
    t.retention.cutoff = CUTOFF;
    await expect(
      t.eventUseCases.void(W1, HANA, { id: r.event.id, reason: 'x' }),
    ).rejects.toMatchObject(outside);
    expect((await t.backend.eventRows())[0]!.voidedAt).toBeNull();
  });

  it('ngày lễ < mốc: PUT / DELETE ⇒ 422 kể cả OWNER có lý do; quyền vẫn kiểm TRƯỚC (người không thuộc ws ⇒ 404)', async () => {
    const t = await setup('2026-11-17 10:00');
    await t.backend.addHoliday(W1, '2026-11-02', 'Lễ cũ');
    t.retention.cutoff = CUTOFF;
    await expect(
      t.calendarUseCases.putHoliday(W1, OLIVIA, '2026-11-02', { name: 'Đổi', reason: 'Sửa' }),
    ).rejects.toMatchObject(outside);
    await expect(
      t.calendarUseCases.deleteHoliday(W1, OLIVIA, '2026-11-02', 'Sửa'),
    ).rejects.toMatchObject(outside);
    expect(await t.calendarUseCases.listHolidays(W1, 2026)).toEqual([
      { date: '2026-11-02', name: 'Lễ cũ' },
    ]);
    t.members.delete(HANA);
    await expect(
      t.calendarUseCases.putHoliday(W1, HANA, '2026-11-02', { name: 'x' }),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('check-in hôm nay không bị ảnh hưởng (hôm nay luôn ≥ mốc)', async () => {
    const t = await setup('2026-11-17 08:00');
    t.retention.cutoff = CUTOFF;
    await expect(t.punch('IN', key(1))).resolves.toMatchObject({ status: 'PRESENT' });
  });
});

describe('job retention TẮT (mốc null — local/test mặc định) ⇒ không che dữ liệu thật, không chặn', () => {
  it('ngày cũ vẫn hiện như thường; ADJUSTMENT / void / ngày lễ cho ngày cũ đều được', async () => {
    const t = await setup('2026-11-17 20:00');
    expect(t.retention.cutoff).toBeNull();
    const r = await t.eventUseCases.adjust(W1, HANA, adjustBody('2024-01-02'));
    await expect(
      t.eventUseCases.void(W1, HANA, { id: r.event.id, reason: 'x' }),
    ).resolves.toBeDefined();
    await expect(
      t.calendarUseCases.putHoliday(W1, OLIVIA, '2024-01-01', { name: 'Tết', reason: 'Nhập bù' }),
    ).resolves.toBeDefined();
    const month = await t.queries.month({ workspaceId: W1, userId: MIA, month: '2026-11' });
    expect(month.days.some((d) => d.status === 'RETENTION_EXPIRED')).toBe(false);
    expect(month.days.find((d) => d.date === '2026-11-02')!.status).toBe('ABSENT');
  });
});
