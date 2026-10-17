import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { prefetchRouteQueries } from './route-prefetch';

// T-044 S3: query của route gửi song song với /auth/me — CHỈ những query route đó chắc chắn dùng.

const WS = '0199e5a2-0000-7000-8000-0000000000a1';
const PID = '0199e5a2-0000-7000-8000-0000000000b1';

function keysFor(pathname: string) {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'prefetchQuery').mockResolvedValue(undefined);
  prefetchRouteQueries(client, pathname);
  return spy.mock.calls.map(([options]) => JSON.stringify(options.queryKey));
}

describe('prefetchRouteQueries', () => {
  it('board /w/:ws/p/:pid ⇒ chuông + workspace + project + board', () => {
    expect(keysFor(`/w/${WS}/p/${PID}`)).toEqual([
      '["notifications","unread"]',
      JSON.stringify(['ws', WS]),
      JSON.stringify(['ws', WS, 'project', PID]),
      expect.stringContaining(PID),
    ]);
    expect(keysFor(`/w/${WS}/p/${PID}/`)).toHaveLength(4);
  });

  it('cài đặt project /w/:ws/p/:pid/settings ⇒ project nhưng KHÔNG tải board', () => {
    const keys = keysFor(`/w/${WS}/p/${PID}/settings`);
    expect(keys).toContain(JSON.stringify(['ws', WS, 'project', PID]));
    expect(keys).toHaveLength(3);
  });

  it('/w/:ws/projects ⇒ chuông + workspace; /w ⇒ chuông + danh sách workspace', () => {
    expect(keysFor(`/w/${WS}/projects`)).toEqual([
      '["notifications","unread"]',
      JSON.stringify(['ws', WS]),
    ]);
    expect(keysFor('/w')).toEqual([
      '["notifications","unread"]',
      expect.stringContaining('workspaces'),
    ]);
  });

  it('route khác (/account) hoặc id không phải uuid ⇒ chỉ chuông, không đoán', () => {
    expect(keysFor('/account')).toEqual(['["notifications","unread"]']);
    expect(keysFor('/w/not-a-uuid/p/x')).toEqual(['["notifications","unread"]']);
  });
});
