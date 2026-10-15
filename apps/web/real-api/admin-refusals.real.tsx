import { apiSuccess } from '@taskflow/contracts/common';
import { ProjectDto } from '@taskflow/contracts/project';
import { WorkspaceDto } from '@taskflow/contracts/workspace';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';

import { session } from '@/entities/session';
import { createOfflineRealtimeClient, createSocketIoClient } from '@/shared/socket';

import { API, ORIGIN, PASSWORD, api, apiRaw, loginOrRegister } from './real-api-client';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-034 / review B F5 — các lần SERVER TỪ CHỐI mà UI dựa vào, kiểm với API THẬT (mock dễ lệch
// server — bài học H2). Mỗi lượt chạy tạo một workspace riêng rồi xóa mềm nó ở cuối.

const WS = new URL(API).origin;
type Raw = Awaited<ReturnType<typeof apiRaw>>;
const errorOf = (raw: Raw) => (raw.json as { error: { code: string; message: string } }).error;

afterAll(() => {
  cleanup();
  session.resetForTest();
});

it.skipIf(!PASSWORD)(
  'API thật: PM cấp OWNER ⇒ 403; slug sai ⇒ 400; đã là thành viên ⇒ 409; PM/cựu thành viên khôi phục ⇒ 404 như id lạ; bị xóa khi mở board ⇒ socket đẩy ra',
  async () => {
    // Chỉ dùng 2 tài khoản sẵn có (đăng ký bị rate-limit theo IP — không lách): real2 làm PM.
    const owner = await loginOrRegister('real1@example.com', 'Trần Lan');
    const pm = await loginOrRegister('real2@example.com', 'Mai Hoa');
    const ws = await api(
      '/workspaces',
      {
        method: 'POST',
        body: { name: `Từ chối ${Date.now() % 100_000}` },
        token: owner.accessToken,
      },
      (j) => apiSuccess(WorkspaceDto).parse(j).data,
    );
    const base = `/workspaces/${ws.id}`;
    const add = (token: string, email: string, role: string) =>
      apiRaw(`${base}/members`, { method: 'POST', body: { email, role }, token });
    const remove = (confirmSlug: string) =>
      apiRaw(base, { method: 'DELETE', body: { confirmSlug }, token: owner.accessToken });
    const restore = (id: string, token: string) =>
      apiRaw(`/workspaces/${id}/restore`, { method: 'POST', token });
    expect((await add(owner.accessToken, 'real2@example.com', 'PM')).status).toBe(201);
    const project = await api(
      `${base}/projects`,
      {
        method: 'POST',
        body: { name: 'Dự án từ chối', keyPrefix: 'TC' },
        token: owner.accessToken,
      },
      (j) => apiSuccess(ProjectDto).parse(j).data,
    );

    // 1. PM cấp OWNER/PM ⇒ 403 — kể cả email lạ (403 trước 404: không dò được email tồn tại).
    for (const [email, role] of [
      ['real1@example.com', 'OWNER'],
      [`khong-co-${Date.now()}@example.com`, 'OWNER'],
      [`khong-co-${Date.now()}@example.com`, 'PM'],
    ] as const) {
      const raw = await add(pm.accessToken, email, role);
      expect([email, role, raw.status, errorOf(raw).code]).toEqual([
        email,
        role,
        403,
        'FORBIDDEN_ACCESS',
      ]);
    }

    // 2. Đã là thành viên ⇒ 409; UI hiện cùng một câu với email lạ (security.md §6.5).
    expect((await add(owner.accessToken, 'real2@example.com', 'MEMBER')).status).toBe(409);
    act(() =>
      session.signIn({ accessToken: owner.accessToken, expiresIn: owner.expiresIn }, owner.user),
    );
    openApp(`/w/${ws.id}/settings/members`, createOfflineRealtimeClient(crypto.randomUUID()));
    const u = userEvent.setup({ delay: null });
    const form = await screen.findByRole('form', { name: 'Thêm thành viên' }, { timeout: 15_000 });
    await u.type(within(form).getByLabelText('Email'), 'real2@example.com');
    await u.click(within(form).getByRole('button', { name: 'Thêm' }));
    expect((await within(form).findByRole('alert', {}, { timeout: 10_000 })).textContent).toMatch(
      /Không thể thêm người này/,
    );
    cleanup();

    // 3. Xóa với slug lệch hoa thường / có khoảng trắng ⇒ 400 VALIDATION_ERROR (không trim/lowercase).
    for (const confirmSlug of [ws.slug.toUpperCase(), ` ${ws.slug}`, `${ws.slug} `]) {
      const raw = await remove(confirmSlug);
      expect([confirmSlug, raw.status, errorOf(raw).code]).toEqual([
        confirmSlug,
        400,
        'VALIDATION_ERROR',
      ]);
    }
    expect((await remove(ws.slug)).status).toBe(200);

    // 4. Khôi phục bằng PM (vẫn là thành viên của ws đã xóa) ⇒ 404, body y như id lạ.
    const unknown = errorOf(await restore(crypto.randomUUID(), owner.accessToken));
    const byPm = await restore(ws.id, pm.accessToken);
    expect([byPm.status, errorOf(byPm)]).toEqual([404, unknown]);
    // OWNER khôi phục được ⇒ 404 ở trên là do quyền, không phải do ws không còn.
    expect((await restore(ws.id, owner.accessToken)).status).toBe(200);

    // 5. Bị xóa khỏi workspace khi đang mở board ⇒ Socket.io thật đẩy `workspace:access-revoked`
    //    ⇒ về /w; join lại phòng project ⇒ RESOURCE_NOT_FOUND.
    act(() => session.signIn({ accessToken: pm.accessToken, expiresIn: pm.expiresIn }, pm.user));
    const socket = createSocketIoClient({
      url: WS,
      clientId: crypto.randomUUID(),
      auth: session.realtimeAuth,
      extraHeaders: { origin: ORIGIN }, // Node (`ws`) không tự gửi Origin như trình duyệt
    });
    openApp(`/w/${ws.id}/p/${project.id}`, socket);
    await screen.findByRole('region', { name: /Cần làm/ }, { timeout: 15_000 });
    await waitFor(() => expect(socket.status()).toBe('connected'), { timeout: 15_000 });
    await new Promise((r) => setTimeout(r, 500)); // để project:join được ack
    await api(
      `${base}/members/${pm.user.id}`,
      { method: 'DELETE', token: owner.accessToken },
      (j) => j,
    );
    await waitFor(() => expect(window.location.pathname).toBe('/w'), { timeout: 10_000 });
    expect(
      await screen.findByText('Bạn không còn truy cập được workspace này', {}, { timeout: 5_000 }),
    ).toBeTruthy();
    expect(await socket.joinProject({ workspaceId: ws.id, projectId: project.id })).toMatchObject({
      ok: false,
      code: 'RESOURCE_NOT_FOUND',
    });
    cleanup();
    socket.disconnect();

    // 6. Cựu thành viên khôi phục ⇒ 404 y như id lạ. Dọn: OWNER khôi phục rồi xóa lại.
    expect((await remove(ws.slug)).status).toBe(200);
    const byFormer = await restore(ws.id, pm.accessToken);
    expect([byFormer.status, errorOf(byFormer)]).toEqual([404, unknown]);
    expect((await restore(ws.id, owner.accessToken)).status).toBe(200);
    expect((await remove(ws.slug)).status).toBe(200);
  },
);
