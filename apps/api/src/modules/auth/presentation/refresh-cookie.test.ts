import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { FakeClock } from '../../../../test/support';
import { RefreshCookie } from './refresh-cookie';

const cookie = new RefreshCookie(true, new FakeClock());
const req = (header?: string) => ({ headers: { cookie: header } }) as unknown as Request;

describe('RefreshCookie.read (T-028)', () => {
  it('một cookie đúng tên ⇒ trả giá trị (giải mã URI)', () => {
    expect(cookie.read(req('a=1; __Secure-tf_rt=abc%2Bdef; b=2'))).toBe('abc+def');
  });

  it('không có / rỗng / sai mã hóa ⇒ undefined', () => {
    expect(cookie.read(req())).toBeUndefined();
    expect(cookie.read(req('__Secure-tf_rt='))).toBeUndefined();
    expect(cookie.read(req('__Secure-tf_rt=%E0%A4%A'))).toBeUndefined();
  });

  it('tên chỉ giống một phần (tf_rt không tiền tố, x__Secure-tf_rt) ⇒ bỏ qua', () => {
    expect(cookie.read(req('tf_rt=attacker; x__Secure-tf_rt=y'))).toBeUndefined();
  });

  it('cookie tossing: HAI cookie trùng tên (subdomain đặt Domain=, Path hẹp hơn đứng trước) ⇒ undefined, không lấy cái đầu', () => {
    expect(cookie.read(req('__Secure-tf_rt=attacker; __Secure-tf_rt=victim'))).toBeUndefined();
  });
});
