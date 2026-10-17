import { describe, expect, it, vi } from 'vitest';

import type { IFileStore } from '../core/files/ports';
import { OpenConversationUseCases } from '../modules/chat/application/open-conversation.use-cases';
import { SendMessageUseCase } from '../modules/chat/application/send-message.use-case';
import { NOW, U, aid, cmid, hex } from '../modules/chat/testing/chat-fixtures';
import { chatKit } from '../modules/chat/testing/chat-use-case-kit';
import { chatSweepTask } from './chat-sweep';

const DAY = 86_400_000;
/** Khóa ngẫu nhiên hợp lệ (26 ký tự base32). */
const key = (c: string) => `chat/${c.repeat(26)}`;

function fakeStore(blobs: Record<string, Date>) {
  const map = new Map(Object.entries(blobs));
  const store = {
    async *list() {
      for (const [k, modifiedAt] of [...map]) yield await Promise.resolve({ key: k, modifiedAt });
    },
    delete: vi.fn((k: string) => Promise.resolve(void map.delete(k))),
  };
  return { store: store as unknown as IFileStore, keys: () => [...map.keys()].sort(), spy: store };
}

async function setup(blobs: Record<string, Date>) {
  const k = chatKit();
  k.staff();
  const conv = (
    await new OpenConversationUseCases(k.deps).direct({ actorId: U.Mia, userId: U.Vic })
  ).conversation.id;
  const upload = (n: number, file: string, createdAt: Date) =>
    k.deps.uow.run(() =>
      k.deps.attachments.createUpload({
        id: aid(n),
        uploaderId: U.Mia,
        kind: 'FILE',
        name: `t${n}.pdf`,
        mime: 'application/pdf',
        sizeBytes: 1,
        sha256: hex('b'),
        width: null,
        height: null,
        fileKey: file,
        previewKey: null,
        thumbKey: null,
        createdAt,
      }),
    );
  const f = fakeStore(blobs);
  const task = chatSweepTask({
    repos: k.deps,
    store: f.store,
    uow: k.deps.uow,
    businessClock: k.deps.clock,
    clock: k.deps.realClock,
    orphanTtlSec: 86_400,
  });
  return { k, conv, upload, f, task };
}

describe('chatSweepTask (ADR-147, T-069)', () => {
  it('CH-12: upload mồ côi > 24 giờ ⇒ xóa dòng rồi blob; < 24 giờ giữ; blob gắn tin giữ', async () => {
    const old = new Date(NOW.getTime() - 2 * DAY);
    const s = await setup({ [key('a')]: old, [key('b')]: old, [key('c')]: old });
    await s.upload(1, key('a'), old);
    await s.upload(2, key('b'), new Date(NOW.getTime() - 3_600_000));
    await s.upload(3, key('c'), old);
    await new SendMessageUseCase(s.k.deps).execute({
      actorId: U.Mia,
      conversationId: s.conv,
      clientMsgId: cmid(1),
      attachmentIds: [aid(3)],
    });
    await s.task.run({ now: NOW });
    expect(s.f.keys()).toEqual([key('b'), key('c')]);
    expect(await s.k.deps.attachments.findById(aid(1))).toBeNull();
  });

  it('CH-11: tin quá 12 tháng (giờ nghiệp vụ) ⇒ xóa kèm blob; biên chưa tới ⇒ giữ', async () => {
    const s = await setup({ [key('d')]: NOW });
    await s.upload(4, key('d'), NOW);
    await new SendMessageUseCase(s.k.deps).execute({
      actorId: U.Mia,
      conversationId: s.conv,
      clientMsgId: cmid(2),
      body: 'cũ',
      attachmentIds: [aid(4)],
    });
    s.k.setNow(new Date(NOW.getTime() + 364 * DAY));
    await s.task.run({ now: NOW });
    expect(s.k.state.data.messages.size).toBe(1);
    s.k.setNow(new Date(NOW.getTime() + 366 * DAY));
    await s.task.run({ now: NOW });
    expect([s.k.state.data.messages.size, s.f.keys()]).toEqual([0, []]);
  });

  it('blob không còn dòng nào tham chiếu: cũ ⇒ xóa; mới (< 24 giờ — upload đang ghi dòng) ⇒ giữ', async () => {
    const s = await setup({
      [key('e')]: new Date(NOW.getTime() - 2 * DAY),
      [key('f')]: new Date(NOW.getTime() - 60_000),
    });
    expect(await s.task.run({ now: NOW })).toBe(1);
    expect(s.f.keys()).toEqual([key('f')]);
  });
});
