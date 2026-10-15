import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { FakeClock } from '../../../../test/support';
import { RefreshCookie } from './refresh-cookie';

const cookie = new RefreshCookie(true, new FakeClock());
const req = (header?: string) => ({ headers: { cookie: header } }) as unknown as Request;

describe('RefreshCookie.read (T-028)', () => {
  it('một cookie đúng tên ⇒ trả giá trị (giải mã URI)', () => {
    expect(cookie.read(req('a=1; __Host-tf_rt=abc%2Bdef; b=2'))).toBe('abc+def');
  });

  it('không có / rỗng / sai mã hóa ⇒ undefined', () => {
    expect(cookie.read(req())).toBeUndefined();
    expect(cookie.read(req('__Host-tf_rt='))).toBeUndefined();
    expect(cookie.read(req('__Host-tf_rt=%E0%A4%A'))).toBeUndefined();
  });

  it('ADR-109: chỉ đọc đúng `__Host-tf_rt` — `tf_rt`, `__Secure-tf_rt` (subdomain cài được) và tên gần giống ⇒ bỏ qua', () => {
    expect(
      cookie.read(req('tf_rt=attacker; __Secure-tf_rt=attacker; x__Host-tf_rt=y')),
    ).toBeUndefined();
  });

  it('cookie tossing: HAI cookie trùng tên (subdomain đặt Domain=, Path hẹp hơn đứng trước) ⇒ undefined, không lấy cái đầu', () => {
    expect(cookie.read(req('__Host-tf_rt=attacker; __Host-tf_rt=victim'))).toBeUndefined();
  });
});
