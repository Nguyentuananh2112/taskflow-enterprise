import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordPolicy,
} from '../../domain/password-policy';
import { loadCommonPasswordList } from './common-password-list';

describe('loadCommonPasswordList', () => {
  const list = loadCommonPasswordList();

  it('nạp danh sách SecLists đã lọc (≥ 40 000 mục)', () => {
    expect(list.size).toBeGreaterThan(40_000);
  });

  it('mọi mục là chữ thường và nằm trong khoảng độ dài của policy (mục ngắn hơn là thừa)', () => {
    for (const entry of list) {
      expect(entry).toBe(entry.toLowerCase());
      expect(entry.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(entry.length).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
    }
  });

  it('chặn được mật khẩu phổ biến thật qua PasswordPolicy', () => {
    const policy = new PasswordPolicy(list);
    expect(policy.check('1Qaz2Wsx3Edc')).toEqual({ ok: false, violations: ['COMMON'] });
    expect(policy.check('qwerty123456')).toEqual({ ok: false, violations: ['COMMON'] });
    expect(policy.check('zt7-kLm9-pQ2-Vx')).toEqual({ ok: true });
  });

  it('trả cùng một Set ở các lần gọi (nạp một lần)', () => {
    expect(loadCommonPasswordList()).toBe(list);
  });
});
