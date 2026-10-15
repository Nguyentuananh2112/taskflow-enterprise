import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';

import { Input } from './index';

describe('Input', () => {
  afterEach(cleanup);

  it('nhãn gắn với ô nhập; hint nằm trong aria-describedby', async () => {
    const { container } = render(<Input label="Email" hint="Dùng email công việc" type="email" />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-describedby')).toBe(
      screen.getByText('Dùng email công việc').id,
    );
    expect(input.getAttribute('aria-invalid')).toBeNull();
    await expectNoA11yViolations(container);
  });

  it('có lỗi ⇒ aria-invalid + mô tả trỏ tới cả hint và lỗi', async () => {
    const { container } = render(
      <Input label="Mật khẩu" hint="Tối thiểu 12 ký tự" error="Mật khẩu quá ngắn" />,
    );
    const input = screen.getByLabelText('Mật khẩu');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
    expect(ids).toEqual([
      screen.getByText('Tối thiểu 12 ký tự').id,
      screen.getByText('Mật khẩu quá ngắn').id,
    ]);
    await expectNoA11yViolations(container);
  });

  it('required: dấu * chỉ để nhìn (aria-hidden), tên truy cập không lẫn "*"', () => {
    render(<Input label="Họ tên" required />);
    const input = screen.getByRole('textbox', { name: 'Họ tên' });
    expect(input).toHaveProperty('required', true);
  });

  it('id truyền vào được giữ nguyên', () => {
    render(<Input label="Slug" id="ws-slug" />);
    expect(screen.getByLabelText('Slug').id).toBe('ws-slug');
  });
});
