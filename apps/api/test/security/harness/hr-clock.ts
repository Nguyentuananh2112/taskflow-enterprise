import { expect } from 'vitest';

import type { Actor, Actors } from './actors';
import { HR } from './hr';

// Ca biên giờ (CLK-HR-*, test-spec-hr §5b): mỗi file một process API với mốc `TEST_CLOCK_ANCHOR` ngay TRƯỚC biên
// (17:30, 00:00, 06:00) rồi chờ giờ SERVER trôi qua biên. Không đọc giờ máy — luôn hỏi `me/today` (serverNow).

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

export async function today(actors: Actors, who: Actor, ws: string): Promise<TodayView> {
  const res = await actors.json('GET', HR.meToday(ws), who.accessToken);
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
export async function expectBefore(actors: Actors, who: Actor, ws: string, boundary: string) {
  const t = await today(actors, who, ws);
  expect(
    vnClock(t.serverNow) < boundary,
    `server đã ${vnClock(t.serverNow)} ≥ ${boundary} — seed quá chậm, tăng khoảng cách mốc`,
  ).toBe(true);
  return t;
}

/** Chờ tới khi `pred(me/today)` đúng (poll 1 s, tối đa `timeoutMs`) — dùng để chờ server trôi qua biên. */
export async function waitToday(
  actors: Actors,
  who: Actor,
  ws: string,
  pred: (t: TodayView) => boolean,
  timeoutMs = 120_000,
): Promise<TodayView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const t = await today(actors, who, ws);
    if (pred(t)) return t;
    if (Date.now() > deadline)
      throw new Error(`hết giờ chờ biên — server ${t.serverNow} (${vnClock(t.serverNow)} VN)`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
}

/** Bối cảnh tối thiểu: Olivia (OWNER, có hr:manage) + Mia, Max (MEMBER). Ít request ⇒ nhanh, kịp trước biên. */
export async function seedTrio(actors: Actors, label: string) {
  const [olivia, mia, max] = await Promise.all([
    actors.register(`${label}-olivia`),
    actors.register(`${label}-mia`),
    actors.register(`${label}-max`),
  ]);
  const ws = olivia.defaultWorkspaceId;
  await Promise.all([
    actors.addMember(olivia, ws, mia, 'MEMBER'),
    actors.addMember(olivia, ws, max, 'MEMBER'),
  ]);
  return { ws, olivia, mia, max };
}
