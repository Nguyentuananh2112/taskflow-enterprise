import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { NEW_PASSWORD_RULES, PasswordInput } from './index';

describe('PasswordInput', () => {
  afterEach(cleanup);

  it('luật hiện sẵn, nằm trong aria-describedby cùng lỗi; a11y', async () => {
    const { container } = render(<PasswordInput label="Mật khẩu mới" error="Mật khẩu quá ngắn" />);
    const input = screen.getByLabelText('Mật khẩu mới');
    expect(input.getAttribute('type')).toBe('password');
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0] ?? '')?.textContent).toContain(NEW_PASSWORD_RULES[0]);
    expect(document.getElementById(ids[1] ?? '')?.textContent).toBe('Mật khẩu quá ngắn');
    await expectNoA11yViolations(container);
  });

  it('nút "Hiện mật khẩu" ⇄ "Ẩn mật khẩu" đổi type, không submit form', async () => {
    let submitted = false;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted = true;
        }}
      >
        <PasswordInput label="Mật khẩu" rules={[]} />
      </form>,
    );
    const u = userEvent.setup({ delay: null });
    await u.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
    expect(screen.getByLabelText('Mật khẩu').getAttribute('type')).toBe('text');
    await u.click(screen.getByRole('button', { name: 'Ẩn mật khẩu' }));
    expect(screen.getByLabelText('Mật khẩu').getAttribute('type')).toBe('password');
    expect(submitted).toBe(false);
  });

  it('rules=[] ⇒ không có danh sách luật', () => {
    render(<PasswordInput label="Mật khẩu hiện tại" rules={[]} />);
    expect(screen.getByLabelText('Mật khẩu hiện tại').getAttribute('aria-describedby')).toBeNull();
  });
});
