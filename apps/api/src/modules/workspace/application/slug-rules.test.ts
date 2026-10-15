import { describe, expect, it } from 'vitest';

import { FakeRandom } from '../../../../test/support';
import { RESERVED_SLUGS, generateSlug, isReservedSlug } from './slug-rules';

/** FakeRandom.int(0, 36) ×6 ⇒ hậu tố; 0..9 ⇒ "0".."9", 10..35 ⇒ "a".."z". */
const suffix = (s: string) => [...s].map((c) => parseInt(c, 36));

describe('slug-rules (R19, ADR-094)', () => {
  it('đủ 13 slug dành riêng', () => {
    expect([...RESERVED_SLUGS].sort()).toEqual(
      [
        'admin',
        'api',
        'app',
        'auth',
        'help',
        'login',
        'new',
        'register',
        'settings',
        'status',
        'support',
        'workspaces',
        'www',
      ].sort(),
    );
    expect(isReservedSlug('admin')).toBe(true);
    expect(isReservedSlug('administrator')).toBe(false);
  });

  it('attempt 0 ⇒ slug gốc không hậu tố, không gọi random (WSC-02)', () => {
    const random = new FakeRandom();
    expect(generateSlug('Đội Phát Triển Sản Phẩm', 0, random)).toBe('doi-phat-trien-san-pham');
    expect(random.tokenRequests).toEqual([]);
  });

  it('attempt ≥ 1 ⇒ thêm "-" + 6 ký tự [a-z0-9] (WSC-09, REG-11)', () => {
    const random = new FakeRandom({ ints: suffix('def456') });
    expect(generateSlug('Alice Nguyen', 1, random)).toBe('alice-nguyen-def456');
  });

  it('tên ra dưới 3 ký tự ⇒ "workspace-xxxxxx" ngay từ attempt 0 (REG-13b)', () => {
    expect(generateSlug('李', 0, new FakeRandom({ ints: suffix('abc123') }))).toBe(
      'workspace-abc123',
    );
    expect(generateSlug('Al', 0, new FakeRandom({ ints: suffix('zzzzzz') }))).toBe(
      'workspace-zzzzzz',
    );
  });

  it('slug gốc trùng slug dành riêng ⇒ "workspace-xxxxxx" (WSC-10, REG-13b)', () => {
    expect(generateSlug('Settings', 0, new FakeRandom({ ints: suffix('q1w2e3') }))).toBe(
      'workspace-q1w2e3',
    );
    expect(generateSlug('Admin', 0, new FakeRandom({ ints: suffix('000000') }))).toBe(
      'workspace-000000',
    );
  });

  it('kết quả luôn hợp lệ R19 (≤ 47 ký tự với tên dài)', () => {
    const slug = generateSlug('x'.repeat(200), 3, new FakeRandom({ ints: suffix('aaaaaa') }));
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slug.length).toBe(47);
  });
});
