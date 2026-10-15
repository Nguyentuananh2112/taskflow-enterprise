import type { IRandom } from '../../../core/domain';
import { slugifyName } from '../domain/names';

/** R19: hằng số của application, không nằm trong contracts. Trùng ⇒ 409 như slug đã có người dùng. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'api',
  'app',
  'www',
  'admin',
  'auth',
  'login',
  'register',
  'settings',
  'workspaces',
  'new',
  'help',
  'support',
  'status',
]);

/** R19: trùng slug ⇒ thử lại cả transaction, tối đa 5 lần (ADR-094). */
export const MAX_SLUG_ATTEMPTS = 5;

const SUFFIX_LENGTH = 6;
const SUFFIX_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const MIN_BASE_LENGTH = 3;
const FALLBACK_BASE = 'workspace';

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

function randomSuffix(random: IRandom): string {
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i += 1) {
    out += SUFFIX_ALPHABET[random.int(0, SUFFIX_ALPHABET.length)] ?? '0';
  }
  return out;
}

/**
 * Slug cho lần thử `attempt` (R19): tên ⇒ phần gốc; gốc < 3 ký tự hoặc dành riêng ⇒ "workspace"
 * LUÔN kèm hậu tố; ngược lại attempt 0 dùng gốc, attempt ≥ 1 thêm "-" + 6 ký tự ngẫu nhiên.
 */
export function generateSlug(name: string, attempt: number, random: IRandom): string {
  const base = slugifyName(name);
  if (base.length < MIN_BASE_LENGTH || isReservedSlug(base)) {
    return `${FALLBACK_BASE}-${randomSuffix(random)}`;
  }
  return attempt === 0 ? base : `${base}-${randomSuffix(random)}`;
}
