import { describe, expect, it } from 'vitest';

import {
  ATTENDANCE_EXPORT_FILE_PATTERN,
  AttendanceExportXlsxQuery,
  DecideCorrectionBody,
  ListCorrectionsQuery,
  SubmitCorrectionBody,
  attendanceExportFileName,
} from './correction.schemas';

const body = { date: '2026-11-16', kind: 'OUT', time: '17:45', reason: 'Quên bấm Ra khi về' };

describe('SubmitCorrectionBody (ADR-129)', () => {
  it('hợp lệ ⇒ nextDay mặc định false; lý do được trim', () => {
    expect(SubmitCorrectionBody.parse({ ...body, reason: '  Quên  ' })).toEqual({
      ...body,
      reason: 'Quên',
      nextDay: false,
    });
  });

  it('strict: userId / status / trường lạ ⇒ lỗi (SEC-HR-45)', () => {
    for (const extra of [
      { userId: '0199e5a2-0000-7000-8000-000000000001' },
      { status: 'APPROVED' },
    ]) {
      expect(SubmitCorrectionBody.safeParse({ ...body, ...extra }).success).toBe(false);
    }
  });

  it('nextDay chỉ cho OUT trước 06:00: 05:59 được; 06:00, IN ⇒ lỗi', () => {
    expect(SubmitCorrectionBody.safeParse({ ...body, time: '05:59', nextDay: true }).success).toBe(
      true,
    );
    expect(SubmitCorrectionBody.safeParse({ ...body, time: '06:00', nextDay: true }).success).toBe(
      false,
    );
    expect(
      SubmitCorrectionBody.safeParse({ ...body, kind: 'IN', time: '01:00', nextDay: true }).success,
    ).toBe(false);
  });

  it('giờ / lý do sai hình dạng ⇒ lỗi', () => {
    for (const over of [
      { time: '24:00' },
      { time: '7:45' },
      { reason: '   ' },
      { reason: 'x'.repeat(501) },
    ]) {
      expect(SubmitCorrectionBody.safeParse({ ...body, ...over }).success).toBe(false);
    }
  });
});

describe('truy vấn / quyết định / xuất', () => {
  it('ListCorrectionsQuery: mine chỉ "1"; status thuộc enum', () => {
    expect(ListCorrectionsQuery.safeParse({ mine: '1', status: 'PENDING' }).success).toBe(true);
    expect(ListCorrectionsQuery.safeParse({ mine: 'true' }).success).toBe(false);
    expect(ListCorrectionsQuery.safeParse({ status: 'DONE' }).success).toBe(false);
  });

  it('DecideCorrectionBody: expectedVersion ≥ 1, note tùy chọn, strict', () => {
    expect(DecideCorrectionBody.safeParse({ expectedVersion: 1 }).success).toBe(true);
    expect(DecideCorrectionBody.safeParse({ expectedVersion: 0 }).success).toBe(false);
    expect(DecideCorrectionBody.safeParse({ expectedVersion: 1, userId: 'x' }).success).toBe(false);
  });

  it('export.xlsx: month YYYY-MM; tên file khớp mẫu SEC-HR-52', () => {
    for (const month of ['2026-13', '2026-1', '../x', '2026-10\r\n']) {
      expect(AttendanceExportXlsxQuery.safeParse({ month }).success).toBe(false);
    }
    expect(AttendanceExportXlsxQuery.parse({ month: '2026-10' })).toEqual({ month: '2026-10' });
    expect(attendanceExportFileName('2026-10')).toMatch(ATTENDANCE_EXPORT_FILE_PATTERN);
  });
});
