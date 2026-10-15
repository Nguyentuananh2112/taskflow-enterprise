/** Ghép class Tailwind, bỏ giá trị rỗng. Không tự gộp class xung đột — class truyền vào đặt SAU để ưu tiên. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
