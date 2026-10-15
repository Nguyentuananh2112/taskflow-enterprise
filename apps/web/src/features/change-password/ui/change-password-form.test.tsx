import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { startMockApi } from '@test/mock-api';
import { cleanupApp, renderWithProviders } from '@test/render';

import { authApi, session } from '@/entities/session';

import { ChangePasswordForm } from '../index';

const OLD = 'mat-khau-cu-rat-dai';
let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi();
  mock.db.createUser({ email: 'lan@example.com', password: OLD, fullName: 'Trần Lan' });
});
afterAll(() => mock.stop());
afterEach(cleanupApp);

async function signIn() {
  const res = await authApi.login({ email: 'lan@example.com', password: OLD });
  session.signIn(res, res.user);
}

async function submit(current: string, next: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Mật khẩu hiện tại/), current);
  await user.type(screen.getByLabelText(/Mật khẩu mới/), next);
  await user.click(screen.getByRole('button', { name: 'Đổi mật khẩu' }));
}

describe('ChangePasswordForm', () => {
  it('sai mật khẩu hiện tại ⇒ lỗi tại field đó (400, không làm mất phiên)', async () => {
    await signIn();
    const { container } = renderWithProviders(<ChangePasswordForm />);
    await submit('khong-phai-mat-khau', 'mat-khau-moi-rat-dai');
    await screen.findByText('Mật khẩu hiện tại không đúng.');
    expect(screen.getByLabelText(/Mật khẩu hiện tại/).getAttribute('aria-invalid')).toBe('true');
    expect((await authApi.me()).user.email).toBe('lan@example.com'); // phiên vẫn còn
    await expectNoA11yViolations(container);
  });

  it('thành công ⇒ toast, form xóa trắng, phiên tiếp tục bằng token mới', async () => {
    await signIn();
    renderWithProviders(<ChangePasswordForm />);
    await submit(OLD, 'mat-khau-moi-rat-dai');
    expect(await screen.findByText('Đã đổi mật khẩu')).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>(/Mật khẩu hiện tại/).value).toBe('');
    // Token cũ đã bị thu hồi phía server (tokenVersion tăng) — request mới vẫn chạy vì token đã thay.
    expect((await authApi.me()).user.fullName).toBe('Trần Lan');
  });
});
