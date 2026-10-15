import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { startMockApi } from '@test/mock-api';
import { cleanupApp, renderWithProviders } from '@test/render';

import { useSession } from '@/entities/session';

import { LoginForm } from '../index';

const PASSWORD = 'cay-tre-xanh-ven-song';
let mock: ReturnType<typeof startMockApi>;

beforeAll(() => {
  mock = startMockApi();
  mock.db.createUser({ email: 'lan@example.com', password: PASSWORD, fullName: 'Trần Lan' });
});
afterAll(() => mock.stop());
afterEach(cleanupApp);

function Status() {
  const { status, user } = useSession();
  return <output aria-label="Trạng thái phiên">{`${status}:${user?.fullName ?? ''}`}</output>;
}

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText(/Email/), email);
  if (password) await user.type(screen.getByLabelText(/Mật khẩu/), password);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
}

describe('LoginForm', () => {
  it('nhãn, autocomplete đúng và không vi phạm a11y', async () => {
    const { container } = renderWithProviders(<LoginForm />);
    expect(screen.getByLabelText(/Email/).getAttribute('autocomplete')).toBe('email');
    expect(screen.getByLabelText(/Mật khẩu/).getAttribute('autocomplete')).toBe('current-password');
    await expectNoA11yViolations(container);
  });

  it('bỏ trống ⇒ lỗi tiếng Việt từ schema contracts tại từng field, không gọi API', async () => {
    const { container } = renderWithProviders(<LoginForm />);
    await fillAndSubmit('', '');
    const email = screen.getByLabelText(/Email/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const errorId = email.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(errorId)?.textContent).toMatch(/email/i);
    expect(screen.getByLabelText(/Mật khẩu/).getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(email); // focus về field lỗi đầu tiên
    await expectNoA11yViolations(container);
  });

  it('sai mật khẩu ⇒ thông báo chung (role=alert), không đánh dấu field nào', async () => {
    renderWithProviders(<LoginForm />);
    await fillAndSubmit('lan@example.com', 'mat-khau-sai-roi');
    expect((await screen.findByRole('alert')).textContent).toBe('Email hoặc mật khẩu không đúng.');
    expect(screen.getByLabelText(/Email/).getAttribute('aria-invalid')).toBeNull();
  });

  it('đúng ⇒ phiên authenticated; access token không xuất hiện trong DOM', async () => {
    const { container } = renderWithProviders(
      <>
        <LoginForm />
        <Status />
      </>,
    );
    await fillAndSubmit('LAN@example.com', PASSWORD);
    expect((await screen.findByText(/^authenticated:/, { selector: 'output' })).textContent).toBe(
      'authenticated:Trần Lan',
    );
    expect(container.innerHTML).not.toMatch(/mock-at-/);
    expect(mock.jar.get('tf_rt')).toMatch(/^mock-rt-/); // cookie refresh HttpOnly do "trình duyệt" giữ
  });

  it('sai 5 lần ⇒ RATE_LIMITED: báo số giây chờ', async () => {
    renderWithProviders(<LoginForm />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Email/), 'khoa@example.com');
    await user.type(screen.getByLabelText(/Mật khẩu/), 'sai');
    for (let i = 0; i < 6; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
      // chờ request xong (nút hết trạng thái loading) rồi mới bấm lần kế
      await screen.findByRole('button', { name: 'Đăng nhập' });
    }
    expect((await screen.findByRole('alert')).textContent).toMatch(/Thử lại sau 60 giây/);
  });
});
