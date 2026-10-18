import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { API_BASE, COMPANY_SCOPE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-058b (ADR-129): đơn bổ sung giờ — nhân viên xin từ chi tiết ngày (thiếu giờ ra ⇒ "Xin bổ sung giờ ra"), thấy "Đã gửi
// đơn" + hủy được; HR duyệt ở tab "Bổ sung giờ (n)" ⇒ ô ngày thành Có mặt; đơn của chính HR ⇒ "Người khác duyệt";
// người gửi đã nghỉ ⇒ "Chỉ có thể từ chối". Hôm nay theo mock: thứ 5 2026-10-15 10:00 (+07). Dữ liệu bịa.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-15T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

const user = () => userEvent.setup({ delay: null });
type Ref = { id: string; fullName: string };

/** Vào làm từ 01/09 (để 14/10 là ngày làm của họ) + một lượt VÀO 08:00 ngày 14/10 không có RA ⇒ MISSING_OUT. */
function missingOut(who: Ref) {
  const row = mock.db.company.row(who.id);
  mock.db.company.add(who.id, '2026-09-01T00:00:00+07:00', '2026-09-01');
  if (row) mock.db.company.setAccess(who.id, row.role, [...row.grants]);
  mock.attendance.adjust(COMPANY_SCOPE, who.id, '2026-10-14', {
    kind: 'IN',
    at: Date.parse('2026-10-14T08:00:00+07:00'),
    by: who,
    note: 'seed',
  });
}

async function submitAs(who: Ref, body: Record<string, unknown>) {
  const response = await getResponse(
    mock.handlers,
    new Request(`${API_BASE}/attendance/corrections`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${mock.db.issueAccess(who as never).accessToken}`,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
  );
  expect(response?.status).toBe(201);
}

const OUT_1745 = { date: '2026-10-14', kind: 'OUT', time: '17:45', reason: 'Quên bấm Ra khi về' };

describe('đơn bổ sung giờ (T-058b)', () => {
  it('nhân viên: thiếu giờ ra ⇒ "Xin bổ sung giờ ra" ⇒ gửi ⇒ "Đã gửi đơn — chờ duyệt" ⇒ Hủy đơn; a11y', async () => {
    const f = seedBoard(mock);
    missingOut(f.owner);
    f.signInAs(f.owner);
    openApp(
      '/attendance',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = user();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    await u.click(within(table).getByRole('button', { name: /^Ngày 14\/10/ }));
    const dialog = await screen.findByRole('dialog', { name: /14\/10$/ });
    await u.click(await within(dialog).findByRole('button', { name: 'Xin bổ sung giờ ra' }));
    const form = within(dialog).getByRole('form', { name: 'Xin bổ sung giờ ra' });
    await u.type(within(form).getByLabelText(/^Giờ ra/), '17:45');
    expect(within(form).queryByLabelText(/Ra sau nửa đêm/)).toBeNull();
    await u.type(within(form).getByLabelText(/^Lý do/), 'Quên bấm Ra khi về');
    await expectNoA11yViolations();
    await u.click(within(form).getByRole('button', { name: 'Gửi đơn' }));
    expect(
      await within(dialog).findByText(/Đã gửi đơn \(xin giờ ra 17:45\) — chờ duyệt/),
    ).toBeTruthy();
    expect(
      screen.getByRole('region', { name: 'Đơn bổ sung giờ của tôi', hidden: true }),
    ).toBeTruthy();

    await u.click(within(dialog).getByRole('button', { name: 'Hủy đơn' }));
    expect(await within(dialog).findByRole('button', { name: 'Xin bổ sung giờ ra' })).toBeTruthy();
  });

  it('giờ ra < 06:00 ⇒ có ô "Ra sau nửa đêm"; giờ ra trước giờ vào ⇒ câu lỗi dễ hiểu', async () => {
    const f = seedBoard(mock);
    missingOut(f.owner);
    f.signInAs(f.owner);
    openApp(
      '/attendance',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = user();
    const table = await screen.findByRole('table', { name: 'Bảng công tháng 10/2026' });
    await u.click(within(table).getByRole('button', { name: /^Ngày 14\/10/ }));
    const dialog = await screen.findByRole('dialog', { name: /14\/10$/ });
    await u.click(await within(dialog).findByRole('button', { name: 'Xin bổ sung giờ ra' }));
    await u.type(within(dialog).getByLabelText(/^Giờ ra/), '07:30');
    await u.type(within(dialog).getByLabelText(/^Lý do/), 'Quên');
    await u.click(within(dialog).getByRole('button', { name: 'Gửi đơn' }));
    expect(await within(dialog).findByText(/Giờ ra phải sau giờ vào/)).toBeTruthy();
    const time = within(dialog).getByLabelText(/^Giờ ra/);
    await u.clear(time);
    await u.type(time, '00:30');
    expect(within(dialog).getByLabelText(/Ra sau nửa đêm/)).toBeTruthy();
  });

  it('HR: tab "Bổ sung giờ (1)" ⇒ Duyệt ⇒ ô 14/10 của An thành Có mặt trong bảng công; đơn của chính mình ⇒ "Người khác duyệt"', async () => {
    const f = seedBoard(mock);
    f.setCompanyAccess(f.owner, 'HR');
    const an = f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
    missingOut(an);
    missingOut(f.owner);
    await submitAs(an, OUT_1745);
    await submitAs(f.owner, { ...OUT_1745, time: '18:00' });
    f.signInAs(f.owner);
    openApp(
      '/hr?tab=corrections',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = user();
    expect(await screen.findByRole('tab', { name: 'Bổ sung giờ (2)' })).toBeTruthy();
    const card = await screen.findByRole('listitem', { name: /^Nguyễn An — / });
    expect(within(card).getByText('Xin giờ ra 17:45')).toBeTruthy();
    expect(within(card).getByText(/Hiện có: vào 8:00 · ra chưa có/)).toBeTruthy();
    expect(within(card).getByText('Lý do: Quên bấm Ra khi về')).toBeTruthy();
    const mine = screen.getByRole('listitem', { name: new RegExp(`^${f.owner.fullName} — `) });
    expect(
      within(mine).getByRole<HTMLButtonElement>('button', { name: 'Người khác duyệt' }).disabled,
    ).toBe(true);
    await expectNoA11yViolations();

    await u.click(
      within(card).getByRole('button', { name: 'Duyệt đơn bổ sung giờ của Nguyễn An' }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: /^Duyệt đơn bổ sung giờ của Nguyễn An/,
    });
    await u.click(within(confirm).getByRole('button', { name: 'Duyệt' }));
    expect(await screen.findByText('Đã duyệt đơn của Nguyễn An')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('listitem', { name: /^Nguyễn An — / })).toBeNull(),
    );
    expect(await screen.findByRole('tab', { name: 'Bổ sung giờ (1)' })).toBeTruthy();
    const day = mock.hr.day(COMPANY_SCOPE, an.id, '2026-10-14');
    expect(day.status).toBe('PRESENT');
  });

  it('HR: người gửi đã nghỉ việc ⇒ Duyệt báo lỗi, chỉ còn "Từ chối"', async () => {
    const f = seedBoard(mock);
    f.setCompanyAccess(f.owner, 'HR');
    const an = f.addUser('Nguyễn An', `an-${crypto.randomUUID()}@example.com`, 'MEMBER');
    missingOut(an);
    await submitAs(an, OUT_1745);
    mock.db.company.remove(an.id);
    f.signInAs(f.owner);
    openApp(
      '/hr?tab=corrections',
      new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id),
    );
    const u = user();
    const card = await screen.findByRole('listitem', { name: /^Nguyễn An — / });
    await u.click(
      within(card).getByRole('button', { name: 'Duyệt đơn bổ sung giờ của Nguyễn An' }),
    );
    await u.click(
      within(await screen.findByRole('dialog', { name: /^Duyệt/ })).getByRole('button', {
        name: 'Duyệt',
      }),
    );
    expect(await screen.findByText(/Người gửi không còn là nhân viên/)).toBeTruthy();
    expect(within(card).getByText('Chỉ có thể từ chối')).toBeTruthy();
    expect(
      within(card).getByRole<HTMLButtonElement>('button', {
        name: 'Duyệt đơn bổ sung giờ của Nguyễn An',
      }).disabled,
    ).toBe(true);
  });
});
