import { expect } from 'vitest';

import type { Actors } from './actors';
import type { CompanyActor, CompanyActors } from './company';
import { HR } from './hr';

// Ca biên giờ (CLK-HR-*, test-spec-hr §5b, test-spec-company §5): mỗi file một process API với mốc
// `TEST_CLOCK_ANCHOR` ngay TRƯỚC biên (17:30, 00:00, 06:00) rồi chờ giờ SERVER trôi qua biên. Không đọc giờ máy —
// luôn hỏi `attendance/me/today` (serverNow).

type Who = Pick<CompanyActor, 'accessToken'>;

export interface TodayView {
  serverNow: string;
  date: string;
  isWorkday: boolean;
  isHoliday: boolean;
  status: string;
  inProgress: boolean;
  firstIn: string | null;
  lastOut: string | null;
}

export async function today(actors: Actors, who: Who): Promise<TodayView> {
  const res = await actors.json('GET', HR.meToday, who.accessToken);
  expect(res.status, res.text.slice(0, 200)).toBe(200);
  return (res.json as { data: TodayView }).data;
}

/** "HH:mm:ss" giờ VN của một thời điểm ISO. */
export const vnClock = (iso: string): string =>
  new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(11, 19);

/**
 * Đảm bảo server CHƯA tới `boundary` (HH:mm:ss VN) — seed chậm quá thì ca không còn kiểm được vế "trước biên"
 * ⇒ báo rõ thay vì xanh/đỏ mơ hồ. Chỉ dùng khi mốc và biên cùng ngày VN.
 */
export async function expectBefore(actors: Actors, who: Who, boundary: string) {
  const t = await today(actors, who);
  expect(
    vnClock(t.serverNow) < boundary,
    `server đã ${vnClock(t.serverNow)} ≥ ${boundary} — seed quá chậm, tăng khoảng cách mốc`,
  ).toBe(true);
  return t;
}

/** Chờ tới khi `pred(me/today)` đúng (poll 1 s, tối đa `timeoutMs`) — dùng để chờ server trôi qua biên. */
export async function waitToday(
  actors: Actors,
  who: Who,
  pred: (t: TodayView) => boolean,
  timeoutMs = 120_000,
): Promise<TodayView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t = await today(actors, who);
    if (pred(t)) return t;
    if (Date.now() > deadline)
      throw new Error(`hết giờ chờ biên — server ${t.serverNow} (${vnClock(t.serverNow)} VN)`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/**
 * Bối cảnh tối thiểu: Hana (nhân viên + HR_MANAGE — thêm ADJUSTMENT, đọc lượt thô) + Mia, Max (nhân viên). Ít request
 * ⇒ nhanh, kịp trước biên. `startDate` cho ca cần nhiệm kỳ bắt đầu trước "hôm nay" của mốc (lượt chấm hôm qua).
 */
export async function seedTrio(actors: CompanyActors, label: string, startDate?: string) {
  const base = startDate ? { startDate } : {};
  const [hana, mia, max] = await Promise.all([
    actors.createUser(`${label}-hana`, { ...base, grants: ['HR_MANAGE'] }),
    actors.createUser(`${label}-mia`, base),
    actors.createUser(`${label}-max`, base),
  ]);
  return { hana, mia, max };
}
