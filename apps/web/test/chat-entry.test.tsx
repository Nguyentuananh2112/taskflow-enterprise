import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-072: lối vào trò chuyện trên header (avatar-chat.md §7 E9) — icon cạnh chuông + badge riêng; < md chấm trên ☰.

let mock: ReturnType<typeof startMockApi>;
beforeEach(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-18T03:00:00.000Z') });
});
afterEach(() => {
  cleanupApp();
  mock.stop();
});

/** Vic gửi `n` tin cho chủ (DIRECT) — ghi thẳng vào store mock. */
function seed(n: number) {
  const f = seedBoard(mock);
  const vic = f.addUser('Vic Phạm', `vic-${crypto.randomUUID()}@example.com`, 'MEMBER');
  const conv = mock.chat.create('DIRECT', { directKey: [f.owner.id, vic.id].sort().join(':') });
  mock.chat.addParticipant(conv.id, f.owner.id, 'MEMBER');
  mock.chat.addParticipant(conv.id, vic.id, 'MEMBER');
  for (let i = 0; i < n; i++) {
    mock.chat.messages.add({
      conversationId: conv.id,
      senderId: vic.id,
      clientMsgId: crypto.randomUUID(),
      requestHash: String(i),
      body: `tin ${i}`,
      replyToId: null,
      attachmentIds: [],
    });
  }
  f.signInAs(f.owner);
  openApp('/w', new FakeRealtimeHub(mock.board, mock.db).client(getClientId(), f.owner.id));
  return f;
}

describe('header — Trò chuyện', () => {
  it('12 tin chưa đọc ⇒ nhãn có số thật, badge "9+", chấm trên ☰', async () => {
    seed(12);
    const link = await screen.findByRole('link', { name: 'Trò chuyện, 12 tin chưa đọc' });
    expect(link.getAttribute('href')).toBe('/chat');
    expect(link.textContent).toContain('9+');
    const menu = screen.getByRole('button', { name: 'Menu' });
    await waitFor(() => expect(menu.querySelector('.bg-danger')).not.toBeNull());
  });

  it('không có tin ⇒ nhãn "Trò chuyện", không badge, không chấm', async () => {
    seed(0);
    const link = await screen.findByRole('link', { name: 'Trò chuyện' });
    expect(link.textContent).not.toMatch(/\d/);
    expect(screen.getByRole('button', { name: 'Menu' }).querySelector('.bg-danger')).toBeNull();
  });
});
