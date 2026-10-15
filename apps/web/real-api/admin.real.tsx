import { MeResponse } from '@taskflow/contracts/auth';
import { apiSuccess } from '@taskflow/contracts/common';
import { ProjectDto } from '@taskflow/contracts/project';
import { TaskDto } from '@taskflow/contracts/task';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { openApp } from '@test/app-harness';

import { session } from '@/entities/session';
import { createOfflineRealtimeClient } from '@/shared/socket';

import { PASSWORD, api, loginOrRegister } from './real-api-client';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-034 — lượt chạy với API THẬT: màn Thành viên / Cài đặt dự án / Cài đặt workspace trên cây app thật
// (REST thật; realtime không dùng ở bộ này — đã có board-two-tabs.real.tsx).

afterAll(() => {
  cleanup();
  session.resetForTest();
});

it.skipIf(!PASSWORD)(
  'API thật: thêm thành viên, hạ Người xem (bỏ giao task), lưu trữ dự án, đổi tên workspace, xóa thành viên',
  async () => {
    const owner = await loginOrRegister('real1@example.com', 'Trần Lan');
    const other = await loginOrRegister('real2@example.com', 'Mai Hoa');
    const me = await api(
      '/auth/me',
      { token: owner.accessToken },
      (j) => apiSuccess(MeResponse).parse(j).data,
    );
    const wsId = me.memberships.find((m) => m.role === 'OWNER')?.workspaceId ?? '';
    const project = await api(
      `/workspaces/${wsId}/projects`,
      { token: owner.accessToken },
      (j) => apiSuccess(z.array(ProjectDto)).parse(j).data[0],
    );
    // Dọn lần chạy trước (nếu real2 còn trong workspace).
    await api(
      `/workspaces/${wsId}/members/${other.user.id}`,
      { method: 'DELETE', token: owner.accessToken },
      (j) => j,
    ).catch(() => null);

    act(() =>
      session.signIn({ accessToken: owner.accessToken, expiresIn: owner.expiresIn }, owner.user),
    );
    const tab = createOfflineRealtimeClient(crypto.randomUUID());
    openApp(`/w/${wsId}/settings/members`, tab);
    const u = userEvent.setup({ delay: null });

    // 1. Email lạ ⇒ câu chung; email thật ⇒ thêm được.
    const form = await screen.findByRole('form', { name: 'Thêm thành viên' }, { timeout: 15_000 });
    await u.type(within(form).getByLabelText('Email'), `khong-co-${Date.now()}@example.com`);
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect((await within(form).findByRole('alert', {}, { timeout: 10_000 })).textContent).toMatch(
      /Không thể thêm người này/,
    );
    await u.clear(within(form).getByLabelText('Email'));
    await u.type(within(form).getByLabelText('Email'), 'real2@example.com');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    await screen.findByRole('combobox', { name: 'Vai trò của Mai Hoa' }, { timeout: 10_000 });

    // 2. Giao 1 task cho real2 rồi hạ Người xem qua UI ⇒ server bỏ giao, UI báo "1 task được bỏ giao".
    const task = await api(
      `/workspaces/${wsId}/projects/${project?.id}/tasks`,
      {
        method: 'POST',
        body: { title: `Việc cho Hoa ${Date.now()}`, assigneeId: other.user.id },
        token: owner.accessToken,
      },
      (j) => apiSuccess(TaskDto).parse(j).data,
    );
    await u.selectOptions(screen.getByRole('combobox', { name: 'Vai trò của Mai Hoa' }), 'VIEWER');
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Đổi vai trò' }),
    );
    expect(await screen.findByText('1 task được bỏ giao', {}, { timeout: 10_000 })).toBeTruthy();
    const after = await api(
      `/workspaces/${wsId}/projects/${project?.id}/tasks/${task.id}`,
      { token: owner.accessToken },
      (j) => apiSuccess(TaskDto).parse(j).data,
    );
    expect(after.assignee).toBeNull();

    // 3. OWNER cuối tự hạ ⇒ LAST_OWNER.
    await u.selectOptions(screen.getByRole('combobox', { name: 'Vai trò của Trần Lan' }), 'PM');
    // F8: tự hạ khỏi Chủ sở hữu phải xác nhận.
    const selfDialog = await screen.findByRole('dialog', { name: /Đổi vai trò của bạn/ });
    expect(selfDialog.textContent).toMatch(/mất quyền Chủ sở hữu/);
    await u.click(within(selfDialog).getByRole('button', { name: 'Đổi vai trò' }));
    expect(
      await screen.findByText('Workspace phải còn ít nhất một Chủ sở hữu', {}, { timeout: 10_000 }),
    ).toBeTruthy();

    // 4. Xóa thành viên.
    await u.click(screen.getByRole('button', { name: 'Xóa Mai Hoa' }));
    await u.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Xóa' }));
    await waitFor(
      () => expect(screen.queryByRole('combobox', { name: 'Vai trò của Mai Hoa' })).toBeNull(),
      { timeout: 10_000 },
    );

    // 5. Cài đặt dự án: lưu trữ ⇒ chỉ đọc; khôi phục.
    cleanup();
    openApp(`/w/${wsId}/p/${project?.id}/settings`, tab);
    await u.click(
      await screen.findByRole('button', { name: 'Lưu trữ dự án' }, { timeout: 15_000 }),
    );
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lưu trữ' }),
    );
    expect(
      await screen.findByText(/Dự án đã lưu trữ — chỉ đọc/, {}, { timeout: 10_000 }),
    ).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Khôi phục dự án' }));
    await screen.findByRole('button', { name: 'Lưu trữ dự án' }, { timeout: 10_000 });

    // 6. Cài đặt workspace: đổi tên (giữ slug).
    cleanup();
    openApp(`/w/${wsId}/settings`, tab);
    const name = await screen.findByLabelText<HTMLInputElement>(
      /^Tên workspace/,
      {},
      { timeout: 15_000 },
    );
    const newName = `Workspace thật ${Date.now() % 10_000}`;
    await u.clear(name);
    await u.type(name, newName);
    await u.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(
      async () => {
        const ws = await api(
          `/workspaces/${wsId}`,
          { token: owner.accessToken },
          (j) => (j as { data: { name: string } }).data,
        );
        expect(ws.name).toBe(newName);
      },
      { timeout: 10_000 },
    );
  },
);
