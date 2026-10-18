import { BusinessRuleViolationError, ForbiddenError, ValidationError } from '../../../core/errors';

// Luật hội thoại THUẦN (avatar-chat.md ADR-143; T-069a). Không I/O: "thuộc công ty hoạt động" và participant HIỆU LỰC
// do repository tính (port chat-conversation.port.ts) và truyền vào đây qua cờ `effective`.

export type ConversationKind = 'DIRECT' | 'GROUP' | 'WORKSPACE';
export type ChatParticipantRole = 'OWNER' | 'MEMBER';

/** = `CHAT_GROUP_MAX_OTHERS` của contracts: tối đa 99 người khác + người tạo = 100. */
export const GROUP_MAX_OTHERS = 99;
const GROUP_MIN_OTHERS = 2;

/** Khóa UNIQUE của DIRECT: `"<uuid nhỏ>:<uuid lớn>"` (so chuỗi chữ thường — thứ tự độc lập người tạo). */
export function directKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

/** `POST chat/direct`: không tự nhắn mình (422 SELF_DIRECT); người kia phải thuộc công ty hoạt động (RECIPIENT_INACTIVE). */
export function assertCanStartDirect(input: {
  actorId: string;
  peerId: string;
  peerActive: boolean;
}): void {
  if (input.actorId.toLowerCase() === input.peerId.toLowerCase()) {
    throw new BusinessRuleViolationError('SELF_DIRECT', 'Không thể tự nhắn tin cho chính mình.');
  }
  if (!input.peerActive) {
    throw new BusinessRuleViolationError(
      'RECIPIENT_INACTIVE',
      'Người nhận chưa kích hoạt tài khoản hoặc đã rời công ty.',
    );
  }
}

/**
 * Thành viên khi tạo nhóm: bỏ người tạo nếu có trong danh sách, khử trùng (không phân biệt hoa); < 2 người khác ⇒
 * 400; > 99 ⇒ 422 GROUP_TOO_LARGE. `inactive` = những id không thuộc công ty hoạt động ⇒ 422 NOT_ACTIVE_MEMBER.
 */
export function groupMembersForCreate(input: {
  creatorId: string;
  memberIds: readonly string[];
  inactive: ReadonlySet<string>;
}): string[] {
  const others = uniqueOthers(input.creatorId, input.memberIds);
  if (others.length < GROUP_MIN_OTHERS) {
    throw new ValidationError(
      [{ path: ['memberIds'], code: 'too_small', message: 'Cần ít nhất 2 người khác.' }],
      'Nhóm cần ít nhất 2 người khác ngoài bạn.',
    );
  }
  assertGroupSize(others.length);
  assertAllActive(others, input.inactive);
  return others;
}

/** Thêm người vào nhóm: bỏ người đang hiệu lực; tổng người khác sau khi thêm ≤ 99. */
export function membersToAdd(input: {
  actorId: string;
  userIds: readonly string[];
  participants: readonly { userId: string; effective: boolean }[];
  inactive: ReadonlySet<string>;
}): string[] {
  const current = new Set(input.participants.filter((p) => p.effective).map((p) => p.userId));
  const fresh = uniqueOthers(input.actorId, input.userIds).filter((id) => !current.has(id));
  assertAllActive(fresh, input.inactive);
  // Người khác = mọi người hiệu lực trừ chính người thao tác (vốn hiệu lực — OWNER).
  assertGroupSize(current.size - (current.has(input.actorId) ? 1 : 0) + fresh.length);
  return fresh;
}

export function assertGroup(kind: ConversationKind): void {
  if (kind !== 'GROUP') {
    throw new BusinessRuleViolationError('NOT_GROUP', 'Thao tác chỉ dành cho nhóm.');
  }
}

interface ParticipantView {
  readonly userId: string;
  readonly role: ChatParticipantRole;
  readonly joinedAt: Date;
  readonly effective: boolean;
}

/**
 * OWNER hiệu lực (ADR-143): người hiệu lực có role OWNER; không còn ai ⇒ người hiệu lực tham gia SỚM NHẤT (hòa ⇒ id
 * nhỏ hơn) được coi là OWNER — thao tác OWNER đầu tiên của họ ghi `role = OWNER` (use case, `needsRoleWrite`).
 */
export function effectiveGroupOwners(participants: readonly ParticipantView[]): {
  ownerIds: string[];
  /** Người được coi là OWNER nhưng role trong DB còn MEMBER. */
  implicitOwnerId: string | null;
} {
  const active = participants.filter((p) => p.effective);
  const owners = active.filter((p) => p.role === 'OWNER').map((p) => p.userId);
  if (owners.length > 0 || active.length === 0) return { ownerIds: owners, implicitOwnerId: null };
  const first = [...active].sort(
    (a, b) =>
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  )[0]!;
  return { ownerIds: [first.userId], implicitOwnerId: first.userId };
}

/** Đổi tên / thêm / bớt / giao OWNER: chỉ OWNER hiệu lực ⇒ khác 403. Trả có cần ghi `role = OWNER` không. */
export function assertGroupOwner(
  actorId: string,
  participants: readonly ParticipantView[],
): { needsRoleWrite: boolean } {
  const { ownerIds, implicitOwnerId } = effectiveGroupOwners(participants);
  if (!ownerIds.includes(actorId)) throw new ForbiddenError('chat:group-owner');
  return { needsRoleWrite: implicitOwnerId === actorId };
}

/** Bớt người: phải đang hiệu lực, không tự bớt mình (dùng "rời"). */
export function assertCanRemove(
  actorId: string,
  targetId: string,
  participants: readonly ParticipantView[],
): void {
  // Không thêm rule mới vào contracts (G giữ): tự bớt mình là yêu cầu sai ⇒ 400, client dùng `POST …/leave`.
  if (actorId === targetId) {
    throw new ValidationError(
      [{ path: ['userId'], code: 'custom', message: 'Không thể tự bớt mình.' }],
      'Dùng "Rời nhóm" để tự rời.',
    );
  }
  if (!participants.some((p) => p.userId === targetId && p.effective)) {
    throw new BusinessRuleViolationError('NOT_ACTIVE_MEMBER', 'Người này không còn trong nhóm.');
  }
}

/** Giao OWNER: người nhận phải đang hiệu lực và khác người giao. */
export function assertCanTransfer(
  actorId: string,
  targetId: string,
  participants: readonly ParticipantView[],
): void {
  if (actorId === targetId || !participants.some((p) => p.userId === targetId && p.effective)) {
    throw new BusinessRuleViolationError('NOT_ACTIVE_MEMBER', 'Người nhận không còn trong nhóm.');
  }
}

/** Gửi được: DIRECT cần người kia còn thuộc công ty hoạt động (người đã nghỉ ⇒ chỉ đọc lịch sử); GROUP/WS luôn được. */
export function canSend(kind: ConversationKind, peerActive: boolean): boolean {
  return kind !== 'DIRECT' || peerActive;
}

function uniqueOthers(selfId: string, ids: readonly string[]): string[] {
  const self = selfId.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const key = id.toLowerCase();
    if (key === self || seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

function assertGroupSize(others: number): void {
  if (others > GROUP_MAX_OTHERS) {
    throw new BusinessRuleViolationError('GROUP_TOO_LARGE', 'Nhóm tối đa 100 người.', {
      max: GROUP_MAX_OTHERS + 1,
    });
  }
}

function assertAllActive(ids: readonly string[], inactive: ReadonlySet<string>): void {
  const bad = ids.filter((id) => inactive.has(id));
  if (bad.length > 0) {
    throw new BusinessRuleViolationError(
      'NOT_ACTIVE_MEMBER',
      'Có người chưa kích hoạt tài khoản hoặc đã rời công ty.',
      { userIds: bad },
    );
  }
}
