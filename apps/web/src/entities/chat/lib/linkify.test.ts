import { describe, expect, it } from 'vitest';

import { linkify } from './linkify';

describe('linkify (ADR-146, SEC-CH-13)', () => {
  it('http(s) thành link, bỏ dấu câu cuối; phần còn lại là text', () => {
    expect(linkify('Xem https://vi.wikipedia.org/wiki/Hà_Nội, nhé.')).toEqual([
      { kind: 'text', text: 'Xem ' },
      {
        kind: 'link',
        text: 'https://vi.wikipedia.org/wiki/Hà_Nội',
        href: 'https://vi.wikipedia.org/wiki/H%C3%A0_N%E1%BB%99i',
      },
      { kind: 'text', text: ', nhé.' },
    ]);
  });

  it('javascript: / data: / HTML ⇒ text nguyên văn, không link', () => {
    for (const body of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      'JAVASCRIPT://%0aalert(1)',
    ]) {
      expect(linkify(body)).toEqual([{ kind: 'text', text: body }]);
    }
  });

  it('nhiều link, xuống dòng giữ nguyên', () => {
    const segs = linkify('a http://x.vn\nb https://y.vn/p?q=1');
    expect(segs.filter((s) => s.kind === 'link').map((s) => s.text)).toEqual([
      'http://x.vn',
      'https://y.vn/p?q=1',
    ]);
    expect(segs.map((s) => s.text).join('')).toBe('a http://x.vn\nb https://y.vn/p?q=1');
  });
});
