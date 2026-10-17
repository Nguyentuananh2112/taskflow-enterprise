// Tiền VND là số NGUYÊN đồng (payroll.md ADR-125) — không float, không số âm trong ô nhập (dấu do mục quyết định).

/** Trần một ô tiền (contract `MoneyVnd`). */
export const MONEY_MAX = 1_000_000_000_000;

const NBSP = ' ';
const group = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** "7.000.000 ₫" — khoảng trắng không ngắt giữa số và ₫ (§5: nowrap + tabular-nums ở nơi hiển thị). */
export function formatVnd(amount: number): string {
  return `${group.format(amount)}${NBSP}₫`;
}

/** "7.000.000" — số trong ô nhập (không ký hiệu tiền). */
export function groupDigits(amount: number): string {
  return group.format(amount);
}

/**
 * Chuỗi người dùng gõ / dán ⇒ số đồng, hoặc `null` khi không hợp lệ. Hiểu "7.000.000", "7,000,000", "7 000 000",
 * "7000000", "7.000.000 ₫"; dấu chấm / phẩy / khoảng trắng chỉ là phân cách nghìn (VND không có phần lẻ). Rỗng ⇒ 0.
 * Có dấu trừ, chữ cái, hoặc vượt trần ⇒ `null`.
 */
export function parseVnd(input: string): number | null {
  const trimmed = input.replace(/[₫đ\s ]/giu, '').replace(/vnd$/iu, '');
  if (trimmed === '') return 0;
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/u.test(trimmed)) return null;
  const value = Number(trimmed.replace(/[.,]/gu, ''));
  return Number.isSafeInteger(value) && value <= MONEY_MAX ? value : null;
}

/** Định dạng lại ô đang gõ: giữ chữ số, chèn dấu chấm nghìn ("7000000" ⇒ "7.000.000"); không hợp lệ ⇒ giữ nguyên. */
export function reformatVndInput(input: string): string {
  const value = parseVnd(input);
  return value === null || input.trim() === '' ? input : groupDigits(value);
}

/**
 * Ô đang GÕ từng phím (giá trị cũ do chính ô định dạng): bỏ dấu chấm nghìn cũ rồi nhóm lại ("6.0000" ⇒ "60.000").
 * Có ký tự khác chữ số / dấu chấm ⇒ giữ nguyên (để ô báo lỗi).
 */
export function regroupTyped(input: string): string {
  const digits = input.replace(/\./gu, '');
  if (!/^\d+$/u.test(digits)) return input;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value <= MONEY_MAX ? groupDigits(value) : input;
}
