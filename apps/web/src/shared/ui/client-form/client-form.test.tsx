import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ClientForm } from './client-form';

// T-029 Medium: form mật khẩu không được gửi bằng submit gốc của trình duyệt trước khi hydrate.

const Form = ({
  onSubmit = vi.fn(),
}: {
  onSubmit?: (event: { preventDefault: () => void }) => void;
}) => (
  <ClientForm onSubmit={onSubmit} aria-label="Đăng nhập">
    <label>
      Mật khẩu <input name="password" type="password" />
    </label>
    <button type="submit">Gửi</button>
  </ClientForm>
);

describe('ClientForm', () => {
  it('HTML server render: method="post" và mọi ô bị khóa (fieldset disabled)', () => {
    const html = renderToString(<Form />);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toMatch(/method="get"/i);
  });

  it('sau khi chạy ở client: mở khóa và submit gọi handler JS', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(<Form onSubmit={onSubmit} />);
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Gửi' });
    expect(button.disabled).toBe(false);
    button.click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
