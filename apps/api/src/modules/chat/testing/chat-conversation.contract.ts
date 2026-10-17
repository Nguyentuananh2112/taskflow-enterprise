import { describe, expect, it } from 'vitest';

import { directKey } from '../domain/chat-conversation';
import type { ChatBackend } from './chat-backend';
import { NOW, U, WS, at, cid, staff } from './chat-fixtures';

// Bộ ca HỢP ĐỒNG IChatConversationStore (T-069a; ADR-143/145) — InMemory (đơn vị) và Prisma (tầng I) chạy y hệt.
// Mốc: nhân viên vào 2026-01-01; "now" 2026-10-18.

export function describeChatConversationContract(name: string, make: () => Promise<ChatBackend>) {
  describe(`${name}: hội thoại`, () => {
    it('DIRECT tạo-hoặc-lấy: lần 2 (đảo người) cùng id, created false; 2 participant', async () => {
      const b = await make();
      await staff(b);
      const key = directKey(U.Vic, U.Mia);
      const first = await b.run(() =>
        b.conversations.getOrCreateDirect({
          id: cid(1),
          directKey: key,
          createdById: U.Mia,
          userIds: [U.Mia, U.Vic],
          at: NOW,
        }),
      );
      const again = await b.run(() =>
        b.conversations.getOrCreateDirect({
          id: cid(2),
          directKey: key,
          createdById: U.Vic,
          userIds: [U.Vic, U.Mia],
          at: at(1),
        }),
      );
      expect(first.created).toBe(true);
      expect(again).toMatchObject({
        created: false,
        conversation: { id: cid(1), kind: 'DIRECT', directKey: key },
      });
      const parts = await b.run(() => b.conversations.participants(cid(1), NOW));
      expect(parts.map((p) => [p.userId, p.effective]).sort()).toEqual([
        [U.Mia, true],
        [U.Vic, true],
      ]);
    });

    it('DIRECT: người kia nghỉ ⇒ mình vẫn đọc, peerActive false; người nghỉ mất quyền; nhận lại ⇒ DIRECT cũ hiện lại', async () => {
      const b = await make();
      await staff(b);
      await b.run(() =>
        b.conversations.getOrCreateDirect({
          id: cid(1),
          directKey: directKey(U.Mia, U.Vic),
          createdById: U.Mia,
          userIds: [U.Mia, U.Vic],
          at: NOW,
        }),
      );
      await b.offboard(U.Vic);
      expect(await b.run(() => b.conversations.canAccess(cid(1), U.Mia, NOW))).toBe(true);
      expect(await b.run(() => b.conversations.canAccess(cid(1), U.Vic, NOW))).toBe(false);
      expect(await b.run(() => b.conversations.summaryFor(cid(1), U.Mia, NOW))).toMatchObject({
        peerId: U.Vic,
        peerActive: false,
        memberCount: 2,
      });
      expect(await b.run(() => b.conversations.recipientIds(cid(1), NOW))).toEqual([U.Mia]);
      await b.hire(U.Vic, 'Vic Lê', at(10));
      expect(await b.run(() => b.conversations.canAccess(cid(1), U.Vic, at(11)))).toBe(true);
    });

    it('GROUP: người tạo OWNER; nghỉ ⇒ hết hiệu lực; nhận lại KHÔNG tự có lại; OWNER thêm lại ⇒ hiệu lực, joined_at mới', async () => {
      const b = await make();
      await staff(b);
      await b.run(() =>
        b.conversations.createGroup({
          id: cid(3),
          title: 'Dự án Sao Mai',
          createdById: U.Mia,
          memberIds: [U.Vic, U.Lan],
          at: NOW,
        }),
      );
      const roles = await b.run(() => b.conversations.participants(cid(3), NOW));
      expect(roles.find((p) => p.userId === U.Mia)?.role).toBe('OWNER');
      expect(await b.run(() => b.conversations.recipientIds(cid(3), NOW))).toHaveLength(3);

      await b.offboard(U.Lan);
      await b.hire(U.Lan, 'Lan Phạm', at(5)); // dòng company_members MỚI
      const later = await b.run(() => b.conversations.participants(cid(3), at(6)));
      expect(later.find((p) => p.userId === U.Lan)).toMatchObject({
        leftAt: null,
        effective: false,
      });
      expect(await b.run(() => b.conversations.canAccess(cid(3), U.Lan, at(6)))).toBe(false);

      await b.run(() => b.conversations.addParticipants(cid(3), [U.Lan], at(7)));
      const back = (await b.run(() => b.conversations.participants(cid(3), at(8)))).find(
        (p) => p.userId === U.Lan,
      );
      expect(back).toMatchObject({ effective: true, role: 'MEMBER', joinedAt: at(7) });

      await b.run(() => b.conversations.markLeft(cid(3), U.Vic, at(9)));
      expect(await b.run(() => b.conversations.canAccess(cid(3), U.Vic, at(10)))).toBe(false);
      await b.run(() => b.conversations.setRole(cid(3), U.Lan, 'OWNER'));
      await b.run(() => b.conversations.rename(cid(3), 'Sao Mai 2', at(10)));
      expect(await b.run(() => b.conversations.summaryFor(cid(3), U.Lan, at(11)))).toMatchObject({
        title: 'Sao Mai 2',
        myRole: 'OWNER',
        memberCount: 2,
      });
    });

    it('GROUP thêm người đang hiệu lực ⇒ giữ joined_at / role', async () => {
      const b = await make();
      await staff(b);
      await b.run(() =>
        b.conversations.createGroup({
          id: cid(4),
          title: 'N',
          createdById: U.Mia,
          memberIds: [U.Vic, U.Lan],
          at: NOW,
        }),
      );
      await b.run(() => b.conversations.addParticipants(cid(4), [U.Mia, U.Vic], at(30)));
      const ps = await b.run(() => b.conversations.participants(cid(4), at(31)));
      expect(ps.find((p) => p.userId === U.Mia)).toMatchObject({ role: 'OWNER', joinedAt: NOW });
      expect(ps.find((p) => p.userId === U.Vic)?.joinedAt).toEqual(NOW);
    });

    it('WORKSPACE: tạo lười một lần; thành viên = workspace_members hoạt động (VIEWER cũng vậy); ws ngừng ⇒ không ai', async () => {
      const b = await make();
      await staff(b);
      await b.workspace({ id: WS, name: 'Phòng Kế toán', memberIds: [U.Mia, U.Vic, U.Pending] });
      const one = await b.run(() =>
        b.conversations.getOrCreateWorkspace({
          id: cid(5),
          workspaceId: WS,
          createdById: U.Mia,
          at: NOW,
        }),
      );
      const two = await b.run(() =>
        b.conversations.getOrCreateWorkspace({
          id: cid(6),
          workspaceId: WS,
          createdById: U.Vic,
          at: at(1),
        }),
      );
      expect([one.created, two.created, two.conversation.id]).toEqual([true, false, cid(5)]);
      expect((await b.run(() => b.conversations.recipientIds(cid(5), NOW))).sort()).toEqual([
        U.Mia,
        U.Vic,
      ]);
      expect(await b.run(() => b.conversations.isWorkspaceMember(WS, U.Lan, NOW))).toBe(false);
      expect(await b.run(() => b.conversations.isWorkspaceMember(WS, U.Pending, NOW))).toBe(false);
      expect(await b.run(() => b.conversations.summaryFor(cid(5), U.Mia, NOW))).toMatchObject({
        title: 'Phòng Kế toán',
        memberCount: 2,
        myRole: null,
      });
      await b.workspace({
        id: WS,
        name: 'Phòng Kế toán',
        memberIds: [U.Mia, U.Vic],
        active: false,
      });
      expect(await b.run(() => b.conversations.canAccess(cid(5), U.Mia, NOW))).toBe(false);
      // findByWorkspace (G, T-070b): ws ngừng hoạt động vẫn tìm được phòng để báo removed; ws chưa mở ⇒ null.
      expect(await b.run(() => b.conversations.findByWorkspace(WS))).toMatchObject({ id: cid(5) });
      expect(await b.run(() => b.conversations.findByWorkspace(cid(99)))).toBeNull();
    });

    it('công ty hoạt động: hết offboard_access_until / chờ kích hoạt ⇒ không; activeUserIds; searchPeople không có người đó', async () => {
      const b = await make();
      await staff(b);
      await b.setAccessUntil(U.Vic, at(5));
      expect(
        await b.run(() => b.conversations.activeUserIds([U.Mia, U.Vic, U.Pending], at(1))),
      ).toEqual(new Set([U.Mia, U.Vic]));
      expect(await b.run(() => b.conversations.activeUserIds([U.Mia, U.Vic], at(5)))).toEqual(
        new Set([U.Mia]),
      );
      const found = await b.run(() => b.conversations.searchPeople('a', 20, at(6)));
      expect(found.map((p) => p.id).sort()).toEqual([U.Mia, U.Lan].sort());
      expect(await b.run(() => b.conversations.searchPeople('PHẠM', 20, at(6)))).toEqual([
        { id: U.Lan, fullName: 'Lan Phạm' },
      ]);
    });
  });
}
