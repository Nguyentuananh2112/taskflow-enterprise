// Tự nhận link trong thân tin (avatar-chat.md ADR-146): CHỈ `http(s)://`; còn lại là text node (React tự escape) —
// `javascript:`, `data:`, HTML trong tin không bao giờ thành phần tử / link (SEC-CH-13).

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
/** Dấu câu cuối URL thường là của câu, không phải của link. */
const TRAILING = /[.,;:!?)\]}'"»”’]+$/;

/** URL hợp lệ, giao thức http(s) ⇒ href chuẩn hóa; khác ⇒ null. */
function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function linkify(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(URL_RE)) {
    const raw = match[0];
    const url = raw.replace(TRAILING, '');
    const start = match.index;
    const href = safeHref(url);
    if (!href) continue;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    out.push({ kind: 'link', text: url, href });
    last = start + url.length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}
