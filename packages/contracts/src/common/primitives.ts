import * as z from 'zod';

/** UUID theo RFC 9562 (chấp nhận v4 và v7 — id sai định dạng ⇒ 400, id lạ ⇒ 404). */
export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

/** Ngày thuần `YYYY-MM-DD` (data-and-api.md D10). */
export const DateOnly = z.iso.date();
export type DateOnly = z.infer<typeof DateOnly>;

/** Thời điểm ISO 8601 dạng UTC (`Z`) — server luôn trả `toISOString()`. */
export const IsoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof IsoDateTime>;
