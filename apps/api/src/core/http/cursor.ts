import type * as z from 'zod';

import { ValidationError } from '../errors';

/**
 * Cursor phân trang **opaque** (data-and-api.md §3.1): base64url của `{ k: kind, v: keys }`.
 * `kind` gắn cursor với một endpoint/khóa sắp xếp ⇒ dùng sai endpoint bị từ chối (400).
 */
export function encodeCursor(kind: string, keys: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify({ k: kind, v: keys }), 'utf8').toString('base64url');
}

const invalidCursor = () =>
  new ValidationError([
    { path: ['cursor'], code: 'invalid_cursor', message: 'Cursor phân trang không hợp lệ.' },
  ]);

/** Giải mã + kiểm `kind` + validate khóa bằng `schema`. Mọi sai lệch ⇒ `ValidationError` trên `cursor`. */
export function decodeCursor<S extends z.ZodType>(
  raw: string,
  kind: string,
  schema: S,
): z.output<S> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null || !('k' in parsed) || !('v' in parsed)) {
    throw invalidCursor();
  }
  if (parsed.k !== kind) throw invalidCursor();
  const keys = schema.safeParse(parsed.v);
  if (!keys.success) throw invalidCursor();
  return keys.data;
}
