import { describe, expect, it } from 'vitest';

import {
  GROUP_MAX_OTHERS,
  assertCanRemove,
  assertCanStartDirect,
  assertCanTransfer,
  assertGroup,
  assertGroupOwner,
  canSend,
  directKey,
  effectiveGroupOwners,
  groupMembersForCreate,
  membersToAdd,
} from './chat-conversation';
import {
  MAX_ATTACHMENTS,
  assertAttachmentCount,
  assertCanEdit,
  assertReplyInConversation,
  assertSameRequest,
  bodyPreview,
  canDelete,
  capUnread,
  compareKeyset,
  requestHash,
} from './chat-message';

// T-069a domain thuần (avatar-chat.md ADR-143/144). Id bịa, dạng uuid.

const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const A = id(0xa);
const B = id(0xb);
const C = id(0xc);
const t = (iso: string) => new Date(iso);
const none = new Set<string>();

type Thrown = { statusCode?: number; details?: Record<string, unknown> };
/** Lỗi ném ra (`undefined` nếu không ném). */
function caught(fn: () => unknown): Thrown | undefined {
  try {
    fn();
  } catch (e) {
    return e as Thrown;
  }
  return undefined;
}
const ruleOf = (fn: () => unknown) => caught(fn)?.details?.['rule'];
const statusOf = (fn: () => unknown) => caught(fn)?.statusCode;

describe('DIRECT', () => {
  it('directKey không phụ thuộc thứ tự, chữ thường', () => {
    expect(directKey(B, A)).toBe(`${A}:${B}`);
    expect(directKey(A, B)).toBe(directKey(B.toUpperCase(), A));
  });

  it('tự nhắn ⇒ SELF_DIRECT (kể cả khác hoa thường); người kia không hoạt động ⇒ RECIPIENT_INACTIVE', () => {
    const start = (peerId: string, peerActive: boolean) => () =>
      assertCanStartDirect({ actorId: A, peerId, peerActive });
    expect(ruleOf(start(A.toUpperCase(), true))).toBe('SELF_DIRECT');
    expect(ruleOf(start(B, false))).toBe('RECIPIENT_INACTIVE');
    expect(caught(start(B, true))).toBeUndefined();
  });

  it('canSend: DIRECT theo người kia; GROUP / WORKSPACE luôn được', () => {
    expect(canSend('DIRECT', false)).toBe(false);
    expect(canSend('DIRECT', true)).toBe(true);
    expect(canSend('GROUP', false)).toBe(true);
    expect(canSend('WORKSPACE', false)).toBe(true);
  });
});

describe('GROUP', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => id(0x100 + i));
  const create =
    (memberIds: string[], inactive: Set<string> = none) =>
    () =>
      groupMembersForCreate({ creatorId: A, memberIds, inactive });

  it('tạo: bỏ người tạo + trùng; < 2 người khác ⇒ 400; 99 được, 100 ⇒ GROUP_TOO_LARGE; người không hoạt động ⇒ 422', () => {
    expect(create([B, A, C, B.toUpperCase()])()).toEqual([B, C]);
    expect(statusOf(create([A, B]))).toBe(400);
    expect(create(many(GROUP_MAX_OTHERS))()).toHaveLength(99);
    expect(ruleOf(create(many(100)))).toBe('GROUP_TOO_LARGE');
    expect(caught(create([B, C], new Set([C])))?.details).toMatchObject({
      rule: 'NOT_ACTIVE_MEMBER',
      userIds: [C],
    });
  });

  it('thêm: bỏ người đang hiệu lực, người đã rời được thêm lại; tổng người khác ≤ 99', () => {
    const p = (userId: string, effective: boolean) => ({ userId, effective });
    const add = (userIds: string[], participants: { userId: string; effective: boolean }[]) => () =>
      membersToAdd({ actorId: A, userIds, participants, inactive: none });
    expect(add([B, C], [p(A, true), p(B, true), p(C, false)])()).toEqual([C]);
    const full = [p(A, true), ...Array.from({ length: 98 }, (_, i) => p(id(0x200 + i), true))];
    expect(add([B], full)()).toEqual([B]);
    expect(ruleOf(add([B, C], full))).toBe('GROUP_TOO_LARGE');
  });

  it('NOT_GROUP cho DIRECT / WORKSPACE', () => {
    expect(ruleOf(() => assertGroup('DIRECT'))).toBe('NOT_GROUP');
    expect(ruleOf(() => assertGroup('WORKSPACE'))).toBe('NOT_GROUP');
    expect(caught(() => assertGroup('GROUP'))).toBeUndefined();
  });

  const part = (userId: string, role: 'OWNER' | 'MEMBER', joinedAt: string, effective = true) => ({
    userId,
    role,
    joinedAt: t(joinedAt),
    effective,
  });

  it('OWNER hiệu lực; không còn ⇒ người hiệu lực sớm nhất (hòa ⇒ id nhỏ), cần ghi role; không ai ⇒ rỗng', () => {
    expect(
      effectiveGroupOwners([part(A, 'OWNER', '2026-01-01'), part(B, 'MEMBER', '2025-01-01')]),
    ).toEqual({ ownerIds: [A], implicitOwnerId: null });
    // OWNER đã rời ⇒ B (sớm nhất còn hiệu lực).
    const orphan = [
      part(A, 'OWNER', '2024-01-01', false),
      part(C, 'MEMBER', '2026-02-01'),
      part(B, 'MEMBER', '2026-01-01'),
    ];
    expect(effectiveGroupOwners(orphan)).toEqual({ ownerIds: [B], implicitOwnerId: B });
    const tie = [part(C, 'MEMBER', '2026-01-01'), part(B, 'MEMBER', '2026-01-01')];
    expect(effectiveGroupOwners(tie).ownerIds).toEqual([B]);
    expect(effectiveGroupOwners([part(A, 'OWNER', '2026-01-01', false)])).toEqual({
      ownerIds: [],
      implicitOwnerId: null,
    });
    expect(assertGroupOwner(B, orphan)).toEqual({ needsRoleWrite: true });
    expect(statusOf(() => assertGroupOwner(C, orphan))).toBe(403);
    expect(assertGroupOwner(A, [part(A, 'OWNER', '2026-01-01')])).toEqual({
      needsRoleWrite: false,
    });
  });

  it('bớt / giao OWNER: người đích phải hiệu lực; tự bớt ⇒ 400; tự giao ⇒ 422', () => {
    const ps = [
      part(A, 'OWNER', '2026-01-01'),
      part(B, 'MEMBER', '2026-01-02'),
      part(C, 'MEMBER', '2026-01-03', false),
    ];
    expect(caught(() => assertCanRemove(A, B, ps))).toBeUndefined();
    expect(statusOf(() => assertCanRemove(A, A, ps))).toBe(400);
    expect(ruleOf(() => assertCanRemove(A, C, ps))).toBe('NOT_ACTIVE_MEMBER');
    expect(caught(() => assertCanTransfer(A, B, ps))).toBeUndefined();
    expect(ruleOf(() => assertCanTransfer(A, A, ps))).toBe('NOT_ACTIVE_MEMBER');
    expect(ruleOf(() => assertCanTransfer(A, C, ps))).toBe('NOT_ACTIVE_MEMBER');
  });
});

describe('tin nhắn', () => {
  const conv = id(0xc0);
  const h = (body: string | null, ids: string[], c = conv) =>
    requestHash({ conversationId: c, body, attachmentIds: ids });

  it('requestHash: thứ tự / hoa thường của attachmentIds không đổi hash; khác hội thoại / thân / tệp ⇒ khác; có ranh giới', () => {
    expect(h('chào', [A, B])).toBe(h('chào', [B.toUpperCase(), A]));
    expect(h('chào', [A])).toMatch(/^[0-9a-f]{64}$/);
    const variants = [
      h('chào', []),
      h('chào ', []),
      h('chào', [A]),
      h('chào', [], id(0xc1)),
      h('', []),
    ];
    expect(new Set(variants).size).toBe(5);
    // Ghép không ranh giới sẽ trùng: ("a|b", []) với ("a", ["b"]).
    expect(h('a|b', [])).not.toBe(h('a', ['b']));
    expect(h(null, [])).toBe(h('', []));
  });

  it('trùng clientMsgId: cùng hash ⇒ được; khác ⇒ IDEMPOTENCY_KEY_REUSED', () => {
    expect(caught(() => assertSameRequest('x', 'x'))).toBeUndefined();
    expect(ruleOf(() => assertSameRequest('x', 'y'))).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('≤ 10 tệp; 11 ⇒ TOO_MANY_ATTACHMENTS; trả lời khác hội thoại ⇒ REPLY_OTHER_CONVERSATION', () => {
    expect(caught(() => assertAttachmentCount(MAX_ATTACHMENTS))).toBeUndefined();
    expect(ruleOf(() => assertAttachmentCount(11))).toBe('TOO_MANY_ATTACHMENTS');
    expect(caught(() => assertReplyInConversation(conv, conv))).toBeUndefined();
    expect(ruleOf(() => assertReplyInConversation(id(0xc1), conv))).toBe(
      'REPLY_OTHER_CONVERSATION',
    );
  });

  const msg = { senderId: A, createdAt: t('2026-10-18T10:00:00Z'), deletedAt: null };

  it('sửa: người gửi, ≤ cửa sổ (biên đúng bằng vẫn được), quá / đã xóa ⇒ EDIT_WINDOW_PASSED; người khác ⇒ 403', () => {
    const edit =
      (
        m: typeof msg | { senderId: string; createdAt: Date; deletedAt: Date },
        actor: string,
        at: string,
      ) =>
      () =>
        assertCanEdit(m, actor, t(at), 900);
    expect(caught(edit(msg, A, '2026-10-18T10:15:00Z'))).toBeUndefined();
    expect(ruleOf(edit(msg, A, '2026-10-18T10:15:00.001Z'))).toBe('EDIT_WINDOW_PASSED');
    expect(statusOf(edit(msg, B, '2026-10-18T10:01:00Z'))).toBe(403);
    const deleted = { ...msg, deletedAt: t('2026-10-18T10:01:00Z') };
    expect(ruleOf(edit(deleted, A, '2026-10-18T10:02:00Z'))).toBe('EDIT_WINDOW_PASSED');
  });

  it('xóa: chỉ người gửi; xóa lại ⇒ false', () => {
    expect(canDelete(msg, A)).toBe(true);
    expect(canDelete({ ...msg, deletedAt: t('2026-10-18T11:00:00Z') }, A)).toBe(false);
    expect(statusOf(() => canDelete(msg, B))).toBe(403);
  });

  it('bodyPreview: 120 code point (emoji = 1), gộp xuống dòng, rỗng / null ⇒ null', () => {
    expect(bodyPreview(null)).toBeNull();
    expect(bodyPreview('  \n ')).toBeNull();
    expect(bodyPreview('a\n\nb')).toBe('a b');
    expect([...bodyPreview('😀'.repeat(130))!]).toHaveLength(121); // 120 + "…"
    expect(bodyPreview('x'.repeat(120))).toBe('x'.repeat(120));
  });

  it('keyset (created_at, id) + trần unread', () => {
    const at = t('2026-10-18T10:00:00Z');
    expect(compareKeyset({ createdAt: at, id: A }, { createdAt: at, id: B })).toBeLessThan(0);
    expect(compareKeyset({ createdAt: at, id: B }, { createdAt: at, id: A })).toBeGreaterThan(0);
    expect(compareKeyset({ createdAt: at, id: A }, { createdAt: at, id: A })).toBe(0);
    const earlier = { createdAt: t('2026-10-18T09:00:00Z'), id: B };
    expect(compareKeyset(earlier, { createdAt: at, id: A })).toBeLessThan(0);
    expect([capUnread(-1), capUnread(5), capUnread(99), capUnread(250)]).toEqual([0, 5, 99, 99]);
  });
});
