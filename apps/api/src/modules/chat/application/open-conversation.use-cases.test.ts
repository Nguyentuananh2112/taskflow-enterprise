import { beforeEach, describe, expect, it } from 'vitest';

import type { BusinessRuleViolationError } from '../../../core/errors';
import { ResourceNotFoundError } from '../../../core/errors';
import { WS, U } from '../testing/chat-fixtures';
import { chatKit, type ChatKit } from '../testing/chat-use-case-kit';
import { ConversationQueries } from './conversation.queries';
import { OpenConversationUseCases } from './open-conversation.use-cases';

const STRANGER = '00000000-0000-7000-8000-00000000cfff';

let k: ChatKit;
let open: OpenConversationUseCases;
beforeEach(() => {
  k = chatKit();
  k.staff();
  open = new OpenConversationUseCases(k.deps);
});

const rule = (e: unknown) => (e as BusinessRuleViolationError).details?.rule;

describe('POST chat/direct (ADR-143)', () => {
  it('tạo-hoặc-lấy: lần 2 (cả chiều ngược lại) trả cùng hội thoại, created=false; peer có ảnh; 1 event lúc tạo', async () => {
    const a = await open.direct({ actorId: U.Mia, userId: U.Vic });
    const b = await open.direct({ actorId: U.Vic, userId: U.Mia });
    expect([a.created, b.created]).toEqual([true, false]);
    expect(b.conversation.id).toBe(a.conversation.id);
    expect(a.conversation).toMatchObject({
      kind: 'DIRECT',
      peer: { id: U.Vic, fullName: 'Vic Lê', avatarUrl: `https://api.test/a/${U.Vic}` },
      canSend: true,
      memberCount: 2,
      myRole: null,
    });
    expect(a.conversation.members.map((m) => m.user.id).sort()).toEqual([U.Mia, U.Vic].sort());
    expect(k.notifier.conversationUpdated).toHaveBeenCalledTimes(1);
  });

  it('chính mình ⇒ SELF_DIRECT; chờ kích hoạt / đã rời ⇒ RECIPIENT_INACTIVE; id lạ ⇒ 404 user', async () => {
    await expect(open.direct({ actorId: U.Mia, userId: U.Mia })).rejects.toSatisfy(
      (e) => rule(e) === 'SELF_DIRECT',
    );
    await expect(open.direct({ actorId: U.Mia, userId: U.Pending })).rejects.toSatisfy(
      (e) => rule(e) === 'RECIPIENT_INACTIVE',
    );
    k.dir.members.delete(U.Lan);
    await expect(open.direct({ actorId: U.Mia, userId: U.Lan })).rejects.toSatisfy(
      (e) => rule(e) === 'RECIPIENT_INACTIVE',
    );
    await expect(open.direct({ actorId: U.Mia, userId: STRANGER })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(k.state.data.conversations.size).toBe(0);
  });

  it('người kia nghỉ sau đó ⇒ vẫn mở được lịch sử qua danh sách, canSend=false, peer.avatarUrl=null', async () => {
    const { conversation } = await open.direct({ actorId: U.Mia, userId: U.Vic });
    k.dir.members.delete(U.Vic);
    const list = await new ConversationQueries(k.deps).list({
      userId: U.Mia,
      cursor: null,
      limit: 30,
    });
    expect(list.items.find((c) => c.id === conversation.id)).toMatchObject({
      canSend: false,
      peer: { id: U.Vic, avatarUrl: null },
    });
  });
});

describe('POST chat/groups', () => {
  it('người tạo OWNER + 2 thành viên; người tạo có trong memberIds ⇒ bỏ qua; event', async () => {
    const { conversation } = await open.group({
      actorId: U.Mia,
      title: 'Dự án Sao Mai',
      memberIds: [U.Vic, U.Lan, U.Mia],
    });
    expect(conversation).toMatchObject({
      kind: 'GROUP',
      title: 'Dự án Sao Mai',
      memberCount: 3,
      myRole: 'OWNER',
    });
    expect(conversation.members.find((m) => m.user.id === U.Mia)?.role).toBe('OWNER');
    expect(k.notifier.conversationUpdated).toHaveBeenCalledOnce();
  });

  it('thành viên chờ kích hoạt ⇒ 422 NOT_ACTIVE_MEMBER; id lạ ⇒ 404; < 2 người khác ⇒ 400; không ghi gì', async () => {
    await expect(
      open.group({ actorId: U.Mia, title: 'x', memberIds: [U.Vic, U.Pending] }),
    ).rejects.toSatisfy((e) => rule(e) === 'NOT_ACTIVE_MEMBER');
    await expect(
      open.group({ actorId: U.Mia, title: 'x', memberIds: [U.Vic, STRANGER] }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      open.group({ actorId: U.Mia, title: 'x', memberIds: [U.Vic, U.Mia] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(k.state.data.conversations.size).toBe(0);
    expect(k.notifier.conversationUpdated).not.toHaveBeenCalled();
  });
});

describe('PUT chat/workspaces/:wsId/conversation (CH-10)', () => {
  beforeEach(() => {
    k.dir.workspaces.set(WS, { name: 'Sao Mai', active: true, memberIds: [U.Mia, U.Vic] });
  });

  it('thành viên ws (kể cả VIEWER — chat không xét role) tạo lười; lần 2 lấy lại; tên phòng = tên ws', async () => {
    const a = await open.workspace({ actorId: U.Mia, workspaceId: WS });
    const b = await open.workspace({ actorId: U.Vic, workspaceId: WS });
    expect([a.created, b.created, b.conversation.id]).toEqual([true, false, a.conversation.id]);
    expect(a.conversation).toMatchObject({ kind: 'WORKSPACE', title: 'Sao Mai', workspaceId: WS });
    expect(a.conversation.members.map((m) => m.user.id).sort()).toEqual([U.Mia, U.Vic].sort());
  });

  it('không phải thành viên / ws xóa mềm ⇒ 404 workspace', async () => {
    await expect(open.workspace({ actorId: U.Lan, workspaceId: WS })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    k.dir.workspaces.set(WS, { name: 'Sao Mai', active: false, memberIds: [U.Mia] });
    await expect(open.workspace({ actorId: U.Mia, workspaceId: WS })).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});
