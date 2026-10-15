/**
 * Id cố định theo tên cho fixture test, đúng dạng UUID (cột `uuid` của Postgres từ chối chuỗi như
 * "user-mia" — cần khi chạy lại bộ test với repo Prisma, T-020). Cùng (kind, name) ⇒ cùng id.
 */
const KIND_TAG = { user: '0001', ws: '0002', project: '0003', other: '0009' } as const;

function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (const ch of input) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function fixtureId(kind: keyof typeof KIND_TAG, name: string): string {
  const key = `${kind}:${name.toLowerCase()}`;
  const a = fnv1a(key, 0x811c9dc5);
  const b = fnv1a(key, 0x01234567);
  return `${a}-${KIND_TAG[kind]}-4000-8000-${b}${a.slice(0, 4)}`;
}

/** Id user theo tên (vd `uid('Mia')`). */
export const uid = (name: string) => fixtureId('user', name);
/** Id project theo keyPrefix (vd `pid('WEB')`). */
export const pid = (keyPrefix: string) => fixtureId('project', keyPrefix);
/** Id workspace theo slug (vd `wsid('acme')`). */
export const wsid = (slug: string) => fixtureId('ws', slug);
/** Id hợp lệ nhưng không tồn tại. */
export const GHOST_ID = fixtureId('other', 'ghost');
