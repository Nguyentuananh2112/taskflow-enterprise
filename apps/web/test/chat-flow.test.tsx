import type { MessageDto } from '@taskflow/contracts/chat';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { stubFetchXhr } from '@test/fetch-xhr';
import { API_BASE, startMockApi } from '@test/mock-api';
import { testRouter } from '@test/navigation';
import { cleanupApp } from '@test/render';

import { navigation } from '@/features/chat-message';
import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-072: trò chuyện trên app thật + mock (avatar-chat.md §7; selector E13 cho F). Mock KHÔNG phát event chat (parity —
// server phát ở T-070) ⇒ test tự phát qua socket giả như server sẽ làm.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.now() });
  stubFetchXhr();
});
afterEach(() => {
  cleanupApp();
  mock.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(seeded = 2) {
  const f = seedBoard(mock);
  const vic = f.addUser('Vic Phạm', `vic-${crypto.randomUUID()}@example.com`, 'MEMBER');
  const conv = mock.chat.create('DIRECT', { directKey: [f.owner.id, vic.id].sort().join(':') });
  mock.chat.addParticipant(conv.id, f.owner.id, 'MEMBER');
  mock.chat.addParticipant(conv.id, vic.id, 'MEMBER');
  const say = (body: string, from = vic.id) =>
    mock.chat.messages.add({
      conversationId: conv.id,
      senderId: from,
      clientMsgId: crypto.randomUUID(),
      requestHash: body,
      body,
      replyToId: null,
      attachmentIds: [],
    });
  for (let i = 0; i < seeded; i++) say(`Vic nói ${i}`);
  f.signInAs(f.owner);
  const client = new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id);
  const envelope = <T,>(type: string, data: T) => ({
    eventId: crypto.randomUUID(),
    type,
    occurredAt: new Date().toISOString(),
    actorId: vic.id,
    originClientId: null,
    data,
  });
  const push = (m: MessageDto) =>
    act(() =>
      client.emitServer('chat:message:new', envelope('chat:message:new', { message: m }) as never),
    );
  const dto = (id: string) =>
    mock.chat.messages.toDto(mock.chat.messages.find(id)!, (u) => mock.chat.userRef(u));
  return { f, vic, conv, say, client, push, dto, envelope };
}

describe('trò chuyện', () => {
  it('danh sách ⇒ mở: luồng, vạch "Tin chưa đọc", đánh dấu đọc ⇒ chưa đọc về 0; a11y', async () => {
    const { f, conv, client } = setup(2);
    openApp('/chat', client);
    const item = await screen.findByRole('link', { name: 'Vic Phạm, 2 tin chưa đọc' });
    expect(item.getAttribute('href')).toBe(`/chat/${conv.id}`);
    act(() => testRouter.push(`/chat/${conv.id}`)); // jsdom: next/link không điều hướng qua router giả
    const log = await screen.findByRole('log', { name: 'Tin nhắn' });
    expect(await within(log).findByText('Vic nói 1')).toBeTruthy();
    await waitFor(() => expect(mock.chat.unread(conv.id, f.owner.id)).toBe(0), { timeout: 3_000 });
    await expectNoA11yViolations();
  });

  it('Enter gửi (lạc quan ⇒ đã gửi); Enter khi đang gõ dấu (isComposing) KHÔNG gửi; echo realtime không nhân đôi', async () => {
    const { conv, client, push, dto } = setup(0);
    openApp(`/chat/${conv.id}`, client);
    const box = await screen.findByRole('textbox', { name: 'Soạn tin' });
    fireEvent.change(box, { target: { value: 'Tiếng Việt' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(mock.chat.messages.of(conv.id)).toHaveLength(0);
    await userEvent.setup().type(box, '{Enter}');
    const log = screen.getByRole('log', { name: 'Tin nhắn' });
    expect(await within(log).findByText('Tiếng Việt')).toBeTruthy();
    await waitFor(() => expect(mock.chat.messages.of(conv.id)).toHaveLength(1));
    push(dto(mock.chat.messages.of(conv.id)[0]!.id)); // echo
    await waitFor(() => expect(within(log).getAllByText('Tiếng Việt')).toHaveLength(1));
    expect(box).toHaveProperty('value', '');
    expect(document.activeElement).toBe(box);
  });

  it('tin ĐẾN qua socket ⇒ hiện + vùng aria-live đọc "Vic: …" (không đọc lịch sử)', async () => {
    const { conv, client, say, push, dto } = setup(1);
    openApp(`/chat/${conv.id}`, client);
    await screen.findByText('Vic nói 0');
    const live = document.querySelector('[aria-live="polite"].sr-only');
    expect(live?.textContent).toBe('');
    const m = say('Có ai không?');
    push(dto(m.id));
    expect(await screen.findByText('Có ai không?')).toBeTruthy();
    await waitFor(() => expect(live?.textContent).toBe('Vic Phạm: Có ai không?'));
  });

  it('đính kèm PDF ⇒ gửi ⇒ "Tải xuống <tên>" ⇒ download-url ⇒ location.assign ngay', async () => {
    const { conv, client } = setup(0);
    const assign = vi.spyOn(navigation, 'assign').mockImplementation(() => undefined);
    openApp(`/chat/${conv.id}`, client);
    const user = userEvent.setup({ applyAccept: false });
    await screen.findByRole('textbox', { name: 'Soạn tin' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      input,
      new File([new TextEncoder().encode('%PDF-1.7 x')], 'Báo cáo.pdf', {
        type: 'application/pdf',
      }),
    );
    const chip = await screen.findByTestId('upload-chip-0');
    await waitFor(() => expect(within(chip).queryByRole('progressbar')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    const download = await screen.findByRole(
      'button',
      { name: 'Tải xuống Báo cáo.pdf' },
      { timeout: 3_000 },
    );
    await user.click(download);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('/media/chat/')),
    );

    // B L1: server / proxy trả URL lạ (javascript:, origin khác) ⇒ KHÔNG điều hướng, báo lỗi.
    assign.mockClear();
    for (const bad of ['javascript:alert(1)', 'https://evil.example/api/v1/media/chat/x/file']) {
      mock.server.use(
        http.post(
          `${API_BASE}/chat/attachments/:id/download-url`,
          () =>
            HttpResponse.json({
              success: true,
              data: { url: bad },
              meta: { timestamp: new Date().toISOString(), requestId: crypto.randomUUID() },
            }),
          { once: true },
        ),
      );
      await user.click(download);
      expect(await screen.findByRole('alert')).toBeTruthy();
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it('xóa tin của mình ⇒ "Tin nhắn đã bị xóa"; tin cũ ⇒ "Tải tin cũ hơn"', async () => {
    const { f, conv, client, say } = setup(55);
    say('Của tôi', f.owner.id);
    openApp(`/chat/${conv.id}`, client);
    const user = userEvent.setup();
    await screen.findByText('Của tôi');
    expect(screen.queryByText('Vic nói 0')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tải tin cũ hơn' }));
    expect(await screen.findByText('Vic nói 0')).toBeTruthy();
    const mine = screen.getByText('Của tôi').closest('article')!;
    await user.click(within(mine).getByRole('button', { name: 'Xóa' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Xóa tin nhắn' })).getByRole('button', {
        name: 'Xóa',
      }),
    );
    expect(await within(mine).findByText('Tin nhắn đã bị xóa')).toBeTruthy();
  });

  it('"Tin nhắn mới" ⇒ tìm người ⇒ mở DIRECT', async () => {
    const { client } = setup(0);
    const kim = mock.db.createUser({
      email: `kim-${crypto.randomUUID()}@example.com`,
      password: 'x',
      fullName: 'Kim Ngân',
    }).user;
    openApp('/chat', client);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tin nhắn mới' }));
    const dialog = await screen.findByRole('dialog', { name: 'Tin nhắn mới' });
    await user.type(within(dialog).getByRole('combobox', { name: 'Tìm người' }), 'Kim');
    await user.click(await within(dialog).findByRole('option', { name: 'Kim Ngân' }));
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/chat\/[0-9a-f-]{36}$/));
    expect(await screen.findByRole('heading', { name: 'Kim Ngân' })).toBeTruthy();
    expect(kim.id).toBeTruthy();
  });

  it('bị gỡ khỏi hội thoại đang mở (chat:conversation:removed) ⇒ về /chat + báo', async () => {
    const { conv, client, envelope } = setup(1);
    openApp(`/chat/${conv.id}`, client);
    await screen.findByText('Vic nói 0');
    act(() =>
      client.emitServer(
        'chat:conversation:removed',
        envelope('chat:conversation:removed', { conversationId: conv.id }) as never,
      ),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/chat'));
    expect(await screen.findByText('Bạn không còn ở cuộc trò chuyện này')).toBeTruthy();
  });

  it('bị bớt khỏi nhóm lúc mất mạng (lỡ removed) ⇒ nối lại, bù gặp 404 ⇒ xóa cache, về /chat + báo (B L1)', async () => {
    const { f, vic, client } = setup(0);
    const group = mock.chat.create('GROUP', { title: 'Nhóm kho' });
    mock.chat.addParticipant(group.id, vic.id, 'OWNER');
    mock.chat.addParticipant(group.id, f.owner.id, 'MEMBER');
    mock.chat.messages.add({
      conversationId: group.id,
      senderId: vic.id,
      clientMsgId: crypto.randomUUID(),
      requestHash: 'x',
      body: 'Tin trong nhóm',
      replyToId: null,
      attachmentIds: [],
    });
    openApp(`/chat/${group.id}`, client);
    await screen.findByText('Tin trong nhóm');
    act(() => client.drop());
    mock.chat.removeParticipant(group.id, f.owner.id); // event removed bị lỡ
    act(() => client.connect());
    await waitFor(() => expect(window.location.pathname).toBe('/chat'));
    expect(await screen.findByText('Bạn không còn ở cuộc trò chuyện này')).toBeTruthy();
  });

  it('phòng workspace /chat/ws/[wsId] ⇒ tạo-hoặc-lấy ⇒ chuyển sang /chat/[id] "# tên ws"', async () => {
    const { f, client } = setup(0);
    openApp(`/chat/ws/${f.wsId}`, client);
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/chat\/[0-9a-f-]{36}$/));
    act(() => testRouter.push(window.location.pathname)); // harness: render lại theo URL mới
    expect(await screen.findByRole('heading', { name: /^# / })).toBeTruthy();
  });
});
