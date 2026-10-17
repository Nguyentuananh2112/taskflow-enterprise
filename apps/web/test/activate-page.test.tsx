import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { startMockApi } from '@test/mock-api';
import { cleanupApp, renderWithProviders } from '@test/render';

import { UserDto } from '@taskflow/contracts/auth';

import { session } from '@/entities/session';
import { forgetActivationToken } from '@/features/account-activate';
import { ActivatePage } from '@/views/activate';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-065b /activate (ADR-137, E B1–B7): ngoài gate; fragment xóa NGAY; mở trang không tiêu token; mật khẩu yếu ⇒ token
// vẫn sống; đang đăng nhập tài khoản khác ⇒ không tự chuyển (máy dùng chung); câu chữ đời thường.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
  window.history.replaceState(null, '', '/');
  forgetActivationToken(); // mỗi ca là một lượt tải trang mới
});

function pendingNina() {
  const { user } = mock.db.createUser({
    email: 'nina@example.com',
    password: '',
    fullName: 'Nguyễn Thị Nina',
    workspace: false,
  });
  const { token } = mock.db.company.issueToken(user.id, mock.db.now(), 7 * 86_400_000);
  return { user, token };
}

function openAt(hash: string) {
  window.history.replaceState(null, '', `/activate${hash}`);
  return renderWithProviders(<ActivatePage />);
}

describe('/activate', () => {
  it('mở link ⇒ fragment xóa ngay; chào tên + tên đăng nhập; mở trang KHÔNG tiêu token; a11y', async () => {
    const { token } = pendingNina();
    const { container } = openAt(`#t=${token}`);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(window.location.pathname).toBe('/activate');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Chào Nguyễn Thị Nina!' }),
    ).toBeTruthy();
    expect(screen.getByText('nina@example.com')).toBeTruthy();
    expect(container.querySelector('input[autocomplete="username"]')?.getAttribute('value')).toBe(
      'nina@example.com',
    );
    expect(mock.db.company.lookup(token, mock.db.now())).not.toBe('gone');
    await expectNoA11yViolations(container);
  });

  it('mật khẩu yếu ⇒ lỗi ở ô mật khẩu, token vẫn dùng được; mật khẩu tốt ⇒ có phiên, vào /w, token đã tiêu', async () => {
    const { token } = pendingNina();
    openAt(`#t=${token}`);
    const u = userEvent.setup({ delay: null });
    const field = await screen.findByLabelText(/^Mật khẩu mới/);
    await u.type(field, 'nina-ngan');
    await u.click(screen.getByRole('button', { name: 'Kích hoạt tài khoản' }));
    expect(await screen.findByText('Mật khẩu cần từ 12 đến 256 ký tự.')).toBeTruthy();
    await u.clear(field);
    await u.type(field, 'nina-mat-khau-dai');
    await u.click(screen.getByRole('button', { name: 'Kích hoạt tài khoản' }));
    expect(await screen.findByText('Mật khẩu không được chứa email.')).toBeTruthy();
    expect(mock.db.company.lookup(token, mock.db.now())).not.toBe('gone');

    await u.clear(field);
    await u.type(field, 'cay-tre-xanh-ven-song');
    await u.click(screen.getByRole('button', { name: 'Kích hoạt tài khoản' }));
    await waitFor(() => expect(window.location.pathname).toBe('/w'));
    expect(mock.db.company.lookup(token, mock.db.now())).toBe('gone');
  });

  it('không có token (tải lại sau khi fragment đã xóa) ⇒ "Hãy mở lại link…"; token rác ⇒ "Link không còn hiệu lực"', async () => {
    openAt('');
    expect(await screen.findByText(/Hãy mở lại link trong tin nhắn/)).toBeTruthy();
    cleanupApp();
    forgetActivationToken(); // lượt tải trang mới
    openAt('#t=rac-khong-hop-le');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Link không còn hiệu lực' }),
    ).toBeTruthy();
    expect(screen.getByText(/xin bộ phận nhân sự link mới/)).toBeTruthy();
  });

  it('máy đang đăng nhập người khác ⇒ KHÔNG tự chuyển, mời đăng xuất; token chưa bị gửi đi', async () => {
    const { token } = pendingNina();
    const { user: lan } = mock.db.createUser({
      email: 'lan@example.com',
      password: 'x',
      fullName: 'Trần Lan',
    });
    act(() => session.signIn(mock.db.issueAccess(lan), UserDto.parse(lan)));
    openAt(`#t=${token}`);
    expect(await screen.findByText(/Bạn đang đăng nhập là/)).toBeTruthy();
    expect(screen.getByText('Trần Lan')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeTruthy();
    expect(window.location.pathname).toBe('/activate');
  });
});
