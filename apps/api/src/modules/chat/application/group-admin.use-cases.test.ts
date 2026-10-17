import { beforeEach, describe, expect, it } from 'vitest';

import type { BusinessRuleViolationError } from '../../../core/errors';
import { ForbiddenError, ResourceNotFoundError } from '../../../core/errors';
import { HIRED, NOW, U } from '../testing/chat-fixtures';
import { chatKit, type ChatKit } from '../testing/chat-use-case-kit';
import { ConversationQueries } from './conversation.queries';
import { GroupAdminUseCases } from './group-admin.use-cases';
import { OpenConversationUseCases } from './open-conversation.use-cases';

const KAY = '00000000-0000-7000-8000-00000000c005';
const rule = (e: unknown) => (e as BusinessRuleViolationError).details?.rule;

let k: ChatKit;
let admin: GroupAdminUseCases;
let g: string;
beforeEach(async () => {
  k = chatKit();
  k.staff();
  k.dir.hire(KAY, 'Kay Đỗ', HIRED);
  admin = new GroupAdminUseCases(k.deps);
  const open = new OpenConversationUseCases(k.deps);
  g = (await open.group({ actorId: U.Mia, title: 'Sao Mai', memberIds: [U.Vic, U.Lan] }))
    .conversation.id;
  k.notifier.conversationUpdated.mockClear();
});

const members = async (as: string = U.Mia) =>
  (await new ConversationQueries(k.deps).detail({ userId: as, conversationId: g })).members
    .map((m) => `${m.user.id}:${m.role}`)
    .sort();

describe('quản trị nhóm (ADR-143, SEC-CH-15)', () => {
  it('OWNER đổi tên, thêm, bớt, giao OWNER — mỗi lệnh trả chi tiết + event; bớt ⇒ conversationRemoved cho người đó', async () => {
    expect(
      (await admin.rename({ actorId: U.Mia, conversationId: g, title: 'Sao Mai 2' })).title,
    ).toBe('Sao Mai 2');
    await admin.addMembers({ actorId: U.Mia, conversationId: g, userIds: [KAY, U.Vic] });
    await admin.removeMember({ actorId: U.Mia, conversationId: g, userId: U.Lan });
    await admin.transferOwner({ actorId: U.Mia, conversationId: g, userId: U.Vic });
    expect(await members()).toEqual([`${U.Mia}:MEMBER`, `${U.Vic}:OWNER`, `${KAY}:MEMBER`].sort());
    expect(k.notifier.conversationUpdated).toHaveBeenCalledTimes(4);
    expect(k.notifier.conversationRemoved).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: g, userIds: [U.Lan] }),
    );
  });

  it('thành viên thường ⇒ 403; người ngoài ⇒ 404; DIRECT ⇒ 422 NOT_GROUP; DB không đổi', async () => {
    await expect(
      admin.rename({ actorId: U.Vic, conversationId: g, title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      admin.addMembers({ actorId: KAY, conversationId: g, userIds: [KAY] }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    const direct = await new OpenConversationUseCases(k.deps).direct({
      actorId: U.Mia,
      userId: U.Vic,
    });
    await expect(
      admin.rename({ actorId: U.Mia, conversationId: direct.conversation.id, title: 'x' }),
    ).rejects.toSatisfy((e) => rule(e) === 'NOT_GROUP');
    expect(
      (await new ConversationQueries(k.deps).detail({ userId: U.Mia, conversationId: g })).title,
    ).toBe('Sao Mai');
  });

  it('thêm người chờ kích hoạt ⇒ 422 NOT_ACTIVE_MEMBER; id lạ ⇒ 404; bớt chính mình ⇒ 400; bớt người đã rời ⇒ 422', async () => {
    await expect(
      admin.addMembers({ actorId: U.Mia, conversationId: g, userIds: [U.Pending] }),
    ).rejects.toSatisfy((e) => rule(e) === 'NOT_ACTIVE_MEMBER');
    await expect(
      admin.addMembers({
        actorId: U.Mia,
        conversationId: g,
        userIds: ['00000000-0000-7000-8000-00000000cfff'],
      }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await expect(
      admin.removeMember({ actorId: U.Mia, conversationId: g, userId: U.Mia }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await admin.leave({ actorId: U.Lan, conversationId: g });
    await expect(
      admin.removeMember({ actorId: U.Mia, conversationId: g, userId: U.Lan }),
    ).rejects.toSatisfy((e) => rule(e) === 'NOT_ACTIVE_MEMBER');
  });

  it('rời ⇒ mất quyền đọc cả lịch sử (404); OWNER cuối rời ⇒ người sớm nhất thành OWNER ngầm, thao tác đầu ghi role', async () => {
    await admin.leave({ actorId: U.Lan, conversationId: g });
    await expect(
      new ConversationQueries(k.deps).detail({ userId: U.Lan, conversationId: g }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    await admin.leave({ actorId: U.Mia, conversationId: g });
    // Vic là người hiệu lực sớm nhất còn lại ⇒ quản trị được ngay
    const out = await admin.rename({ actorId: U.Vic, conversationId: g, title: 'Của Vic' });
    expect(out.myRole).toBe('OWNER');
    expect(await members(U.Vic)).toEqual([`${U.Vic}:OWNER`]);
  });

  it('thêm lại người đã rời ⇒ thấy lại toàn bộ lịch sử (joined_at mới)', async () => {
    await admin.leave({ actorId: U.Lan, conversationId: g });
    k.setNow(new Date(NOW.getTime() + 60_000));
    await admin.addMembers({ actorId: U.Mia, conversationId: g, userIds: [U.Lan] });
    const d = await new ConversationQueries(k.deps).detail({ userId: U.Lan, conversationId: g });
    expect(d.id).toBe(g);
  });

  it('tắt tiếng: chỉ người tham gia; người ngoài ⇒ 404', async () => {
    await admin.setMuted({ actorId: U.Vic, conversationId: g, muted: true });
    const d = await new ConversationQueries(k.deps).detail({ userId: U.Vic, conversationId: g });
    expect(d.muted).toBe(true);
    await expect(
      admin.setMuted({ actorId: KAY, conversationId: g, muted: true }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
