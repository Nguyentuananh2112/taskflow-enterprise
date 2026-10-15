import { ValidationError } from '../../../core/errors';

const NAME_MAX = 100;
const CONTROL_CHARS = /\p{Cc}/u;
const SLUG_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 50;
/** R19: phần gốc sinh từ tên cắt còn 40 ký tự (chừa chỗ cho hậu tố `-xxxxxx`). */
const SLUG_BASE_MAX = 40;

/** Tên workspace/project (R19): trim, 1–100 ký tự (code point), không ký tự điều khiển. */
export function normalizeName(raw: string, field: string): string {
  const value = raw.trim();
  const length = [...value].length;
  const fail = (code: string, message: string) =>
    new ValidationError([{ path: [field], code, message }]);
  if (length === 0) throw fail('too_small', 'Tên không được để trống.');
  if (length > NAME_MAX) throw fail('too_big', `Tên tối đa ${NAME_MAX} ký tự.`);
  if (CONTROL_CHARS.test(value)) throw fail('invalid_format', 'Tên chứa ký tự không hợp lệ.');
  return value;
}

/** Không tự lowercase: chữ hoa ⇒ không hợp lệ (URL người dùng thấy đúng như đã gửi — R19). */
export function isValidSlugFormat(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && SLUG_FORMAT.test(slug);
}

export function assertSlugFormat(slug: string): void {
  if (!isValidSlugFormat(slug)) {
    throw new ValidationError([
      {
        path: ['slug'],
        code: 'invalid_format',
        message: 'Slug chỉ gồm chữ thường, số và dấu gạch ngang, dài 3–50 ký tự.',
      },
    ]);
  }
}

/**
 * Phần gốc của slug sinh từ tên (R19): bỏ dấu tiếng Việt (NFD + bỏ dấu, đ→d), lowercase, ký tự
 * khác [a-z0-9] thành "-", gộp và cắt "-" hai đầu, cắt 40 ký tự. Có thể trả chuỗi ngắn/rỗng —
 * application quyết định dùng "workspace" thay thế.
 */
export function slugifyName(name: string): string {
  return name
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_BASE_MAX)
    .replace(/-+$/g, '');
}
