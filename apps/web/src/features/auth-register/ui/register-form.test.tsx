import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { startMockApi } from '@test/mock-api';
import { cleanupApp, renderWithProviders } from '@test/render';

import { useSession } from '@/entities/session';

import { RegisterForm } from '../index';

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi();
  mock.db.createUser({ email: 'da-co@example.com', password: 'mat-khau-cu-dai', fullName: 'Có' });
});
afterAll(() => mock.stop());
afterEach(cleanupApp);

function Status() {
  return <output aria-label="Trạng thái phiên">{useSession().status}</output>;
}

async function submit(values: { fullName?: string; email?: string; password?: string }) {
  const user = userEvent.setup();
  if (values.fullName) await user.type(screen.getByLabelText(/Họ tên/), values.fullName);
  if (values.email) await user.type(screen.getByLabelText(/Email/), values.email);
  if (values.password) await user.type(screen.getByLabelText(/Mật khẩu/), values.password);
  await user.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
}

const errorOf = (label: RegExp) => {
  const input = screen.getByLabelText(label);
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent).join(' | ');
};

describe('RegisterForm', () => {
  it('mật khẩu 11 ký tự ⇒ lỗi tại field (luật 12–256 của contracts), hint vẫn đọc được', async () => {
    const { container } = renderWithProviders(<RegisterForm />);
    await submit({ fullName: 'Lan', email: 'lan@example.com', password: 'mat-khau-11' });
    expect(screen.getByLabelText(/Mật khẩu/).getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(/Mật khẩu/)).toMatch(/Từ 12 đến 256 ký tự.*\|.*12/);
    await expectNoA11yViolations(container);
  });

  it('mật khẩu 12 ký tự tiếng Việt có dấu (đếm code point) ⇒ hợp lệ, đăng ký thành công', async () => {
    renderWithProviders(
      <>
        <RegisterForm />
        <Status />
      </>,
    );
    await submit({ fullName: 'Nguyễn Văn An', email: 'an@example.com', password: 'Đường-về-nhà' });
    expect(await screen.findByText('authenticated', { selector: 'output' })).toBeDefined();
  });

  it('email đã dùng ⇒ lỗi gắn tại trường email (frontend.md §1.2)', async () => {
    renderWithProviders(<RegisterForm />);
    await submit({ fullName: 'Lan', email: 'da-co@example.com', password: 'mot-mat-khau-dai' });
    await screen.findByText('Email đã được sử dụng.');
    expect(screen.getByLabelText(/Email/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('mật khẩu phổ biến (chỉ server biết) ⇒ lỗi từ VALIDATION_ERROR.issues tại password', async () => {
    renderWithProviders(<RegisterForm />);
    await submit({ fullName: 'Lan', email: 'moi@example.com', password: 'password1234' });
    expect(await screen.findByText(/quá phổ biến/)).toBeDefined();
    expect(screen.getByLabelText(/Mật khẩu/).getAttribute('aria-invalid')).toBe('true');
  });
});
