import { ValidationError } from '../../../core/errors';

// Luật trường của task (data-and-api §6.2 R1/R2/R4). Zod ở biên đã kiểm; entity vẫn tự bảo vệ.
export const TITLE_MIN = 3;
export const TITLE_MAX = 150;
export const DESCRIPTION_MAX = 10_000;
const DUE_YEAR_MIN = 2000;
const DUE_YEAR_MAX = 2100;

const CONTROL_CHARS = /\p{Cc}/u;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n\r\t]/u;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const invalid = (field: string, code: string, message: string) =>
  new ValidationError([{ path: [field], code, message }]);

/** R1: trim, 3–150 ký tự, một dòng, không ký tự điều khiển. */
export function normalizeTitle(raw: string): string {
  const value = raw.trim();
  if (value.length < TITLE_MIN) {
    throw invalid('title', 'too_small', `Tiêu đề phải có ít nhất ${TITLE_MIN} ký tự.`);
  }
  if (value.length > TITLE_MAX) {
    throw invalid('title', 'too_big', `Tiêu đề tối đa ${TITLE_MAX} ký tự.`);
  }
  if (CONTROL_CHARS.test(value)) {
    throw invalid('title', 'invalid_format', 'Tiêu đề chứa ký tự không hợp lệ.');
  }
  return value;
}

/** R2: ≤ 10 000 ký tự, cho phép xuống dòng; rỗng sau trim hoặc `null` ⇒ `null`. */
export function normalizeDescription(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  if (value.length > DESCRIPTION_MAX) {
    throw invalid('description', 'too_big', `Mô tả tối đa ${DESCRIPTION_MAX} ký tự.`);
  }
  if (CONTROL_EXCEPT_NEWLINE.test(value)) {
    throw invalid('description', 'invalid_format', 'Mô tả chứa ký tự không hợp lệ.');
  }
  return value;
}

/** R4: `YYYY-MM-DD` có thật, năm 2000–2100; cho phép quá khứ. `null` = không có hạn. */
export function normalizeDueDate(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const m = DATE_ONLY.exec(raw);
  const fail = () => invalid('dueDate', 'invalid_format', 'Hạn chót phải là ngày YYYY-MM-DD.');
  if (!m) throw fail();
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw fail();
  if (year < DUE_YEAR_MIN || year > DUE_YEAR_MAX) {
    throw invalid('dueDate', 'too_big', `Năm phải trong khoảng ${DUE_YEAR_MIN}–${DUE_YEAR_MAX}.`);
  }
  return raw;
}

/** Bất biến: số thứ tự task (TF-n) là số nguyên ≥ 1. */
export function assertTaskNumber(number: number): void {
  if (!Number.isInteger(number) || number < 1) {
    throw invalid('number', 'too_small', 'Số task phải là số nguyên ≥ 1.');
  }
}
