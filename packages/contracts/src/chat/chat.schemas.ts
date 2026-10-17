import * as z from 'zod';

import { AvatarUrl, UserRefDto } from '../auth/auth.schemas';
import { Cursor, IsoDateTime, limitQuery, singleLineText, Uuid } from '../common/primitives';

// Mốc 6 — trò chuyện (docs/design/avatar-chat.md §4, ADR-143…146). Contract làm SỚM cho web (T-072 trên mock);
// route thật ở T-069, realtime ở T-070. Lỗi nghiệp vụ 422 = `BUSINESS_RULE_VIOLATION` + `details.rule`
// (SELF_DIRECT, RECIPIENT_INACTIVE, NOT_ACTIVE_MEMBER, NOT_GROUP, EDIT_WINDOW_PASSED, REPLY_OTHER_CONVERSATION,
// GROUP_TOO_LARGE, TOO_MANY_ATTACHMENTS, IDEMPOTENCY_KEY_REUSED). Trần schema RỘNG hơn trần nghiệp vụ có chủ ý
// (11 tệp ⇒ 422 `TOO_MANY_ATTACHMENTS`, 100 người ⇒ 422 `GROUP_TOO_LARGE` — không phải 400).

export const ConversationKind = z.enum(['DIRECT', 'GROUP', 'WORKSPACE']);
export type ConversationKind = z.infer<typeof ConversationKind>;

export const ChatParticipantRole = z.enum(['OWNER', 'MEMBER']);
export type ChatParticipantRole = z.infer<typeof ChatParticipantRole>;

export const AttachmentKind = z.enum(['IMAGE', 'FILE']);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

export const CHAT_BODY_MAX_CODE_POINTS = 4_000;
export const CHAT_GROUP_MAX_OTHERS = 99;
export const CHAT_EDIT_WINDOW_SECONDS = 15 * 60;
export const CHAT_UNREAD_CAP = 99;

// eslint-disable-next-line no-control-regex -- C0 trừ TAB/LF/CR; DEL; C1
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

/** Thân tin: NFC, trim, ≤ 4 000 code point (CH-05), văn bản thuần nhiều dòng; rỗng được khi có đính kèm. */
export const ChatBody = z
  .string()
  .transform((s) => s.normalize('NFC').trim())
  .refine((s) => [...s].length <= CHAT_BODY_MAX_CODE_POINTS, {
    message: `Tối đa ${CHAT_BODY_MAX_CODE_POINTS} ký tự.`,
  })
  .refine((s) => !BODY_CONTROL.test(s), { message: 'Không được chứa ký tự điều khiển.' });

/** URL ký tuyệt đối tới `/api/v1/media/…` (ảnh: khung 1–2 giờ). */
const SignedUrl = z.url({ protocol: /^https?$/ });

// ---------------------------------------------------------------- DTO

export const AttachmentDto = z.object({
  id: Uuid,
  kind: AttachmentKind,
  /** Tên đã làm sạch — hiển thị bằng text, không bao giờ là HTML. */
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.int().min(0),
  /** Giữ chỗ khi cuộn (E8); null với FILE. */
  width: z.int().min(1).nullable(),
  height: z.int().min(1).nullable(),
  /** IMAGE: URL ký sẵn; FILE: null ⇒ `POST chat/attachments/:id/download-url`. */
  previewUrl: SignedUrl.nullable(),
  thumbUrl: SignedUrl.nullable(),
});
export type AttachmentDto = z.infer<typeof AttachmentDto>;

export const MessageReplyDto = z.object({
  id: Uuid,
  sender: UserRefDto,
  /** ≤ 120 code point đầu của thân; null khi tin gốc đã xóa hoặc chỉ có đính kèm. */
  bodyPreview: z.string().nullable(),
  deleted: z.boolean(),
});
export type MessageReplyDto = z.infer<typeof MessageReplyDto>;

export const MessageDto = z.object({
  id: Uuid,
  conversationId: Uuid,
  sender: UserRefDto,
  /** Người gửi khử trùng echo realtime đến trước response (E6). */
  clientMsgId: Uuid,
  /** null khi đã xóa. */
  body: z.string().nullable(),
  replyTo: MessageReplyDto.nullable(),
  attachments: z.array(AttachmentDto),
  createdAt: IsoDateTime,
  editedAt: IsoDateTime.nullable(),
  deletedAt: IsoDateTime.nullable(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const MessagePreviewDto = z.object({
  id: Uuid,
  sender: UserRefDto,
  bodyPreview: z.string().nullable(),
  attachmentCount: z.int().min(0),
  deleted: z.boolean(),
  createdAt: IsoDateTime,
});
export type MessagePreviewDto = z.infer<typeof MessagePreviewDto>;

export const ConversationDto = z.object({
  id: Uuid,
  kind: ConversationKind,
  /** GROUP: tên nhóm; WORKSPACE: tên workspace (server điền); DIRECT: null (dùng `peer`). */
  title: z.string().nullable(),
  workspaceId: Uuid.nullable(),
  /** DIRECT: người kia (đã nghỉ ⇒ `avatarUrl` null, `canSend` false). */
  peer: UserRefDto.nullable(),
  /** Số thành viên hiệu lực (GROUP / WORKSPACE); DIRECT: 2. */
  memberCount: z.int().min(0),
  lastMessage: MessagePreviewDto.nullable(),
  lastMessageAt: IsoDateTime.nullable(),
  /** Tin chưa đọc, trần 99 (CH-07). */
  unread: z.int().min(0).max(CHAT_UNREAD_CAP),
  muted: z.boolean(),
  canSend: z.boolean(),
  /** GROUP: vai trò của mình; khác: null. */
  myRole: ChatParticipantRole.nullable(),
});
export type ConversationDto = z.infer<typeof ConversationDto>;

export const ConversationMemberDto = z.object({
  user: UserRefDto,
  role: ChatParticipantRole,
  joinedAt: IsoDateTime,
});
export type ConversationMemberDto = z.infer<typeof ConversationMemberDto>;

/** `GET chat/conversations/:id` — kèm thành viên (GROUP / WORKSPACE). */
export const ConversationDetailDto = ConversationDto.extend({
  members: z.array(ConversationMemberDto),
});
export type ConversationDetailDto = z.infer<typeof ConversationDetailDto>;

export const ChatPersonDto = z.object({
  id: Uuid,
  fullName: z.string(),
  avatarUrl: AvatarUrl.optional(),
});
export type ChatPersonDto = z.infer<typeof ChatPersonDto>;

export const UnreadCountDto = z.object({ total: z.int().min(0) });
export type UnreadCountDto = z.infer<typeof UnreadCountDto>;

export const UploadResponseDto = z.object({
  uploadId: Uuid,
  kind: AttachmentKind,
  name: z.string(),
  sizeBytes: z.int().min(0),
  width: z.int().min(1).nullable(),
  height: z.int().min(1).nullable(),
});
export type UploadResponseDto = z.infer<typeof UploadResponseDto>;

/** `POST chat/attachments/:id/download-url` ⇒ URL `purpose=download` hạn 60 s; web `location.assign(url)` ngay. */
export const DownloadUrlDto = z.object({ url: SignedUrl });
export type DownloadUrlDto = z.infer<typeof DownloadUrlDto>;

// ---------------------------------------------------------------- query / body

export const ConversationParams = z.object({ id: Uuid });
export const MessageParams = z.object({ id: Uuid });
export const ConversationMemberParams = z.object({ id: Uuid, userId: Uuid });
export const WorkspaceConversationParams = z.object({ wsId: Uuid });
export const AttachmentParams = z.object({ id: Uuid });

export const ListConversationsQuery = z.strictObject({
  cursor: Cursor.optional(),
  limit: limitQuery(50, 30),
});
export type ListConversationsQuery = z.infer<typeof ListConversationsQuery>;

/** Keyset `(created_at, id)`: `before` ⇒ trang cũ hơn (≤ 50), `after` ⇒ bù khi nối lại (≤ 200). Không cả hai. */
export const ListMessagesQuery = z
  .strictObject({
    before: Uuid.optional(),
    after: Uuid.optional(),
    limit: limitQuery(200, 50),
  })
  .refine((q) => !(q.before && q.after), { message: 'Chỉ dùng một trong before / after.' });
export type ListMessagesQuery = z.infer<typeof ListMessagesQuery>;

export const ChatPeopleQuery = z.strictObject({ q: z.string().trim().min(1).max(100) });
export type ChatPeopleQuery = z.infer<typeof ChatPeopleQuery>;

export const UploadQuery = z.strictObject({ as: z.enum(['image', 'file']) });
export type UploadQuery = z.infer<typeof UploadQuery>;

export const CreateDirectBody = z.strictObject({ userId: Uuid });
export type CreateDirectBody = z.infer<typeof CreateDirectBody>;

const GroupTitle = singleLineText(1, 80);
const MemberIds = z
  .array(Uuid)
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Trùng thành viên.' });

export const CreateGroupBody = z.strictObject({ title: GroupTitle, memberIds: MemberIds.min(2) });
export type CreateGroupBody = z.infer<typeof CreateGroupBody>;

export const RenameGroupBody = z.strictObject({ title: GroupTitle });
export type RenameGroupBody = z.infer<typeof RenameGroupBody>;

export const AddGroupMembersBody = z.strictObject({ userIds: MemberIds.min(1) });
export type AddGroupMembersBody = z.infer<typeof AddGroupMembersBody>;

export const TransferOwnerBody = z.strictObject({ userId: Uuid });
export type TransferOwnerBody = z.infer<typeof TransferOwnerBody>;

export const SendMessageBody = z
  .strictObject({
    clientMsgId: Uuid,
    body: ChatBody.optional(),
    replyToId: Uuid.optional(),
    attachmentIds: z.array(Uuid).max(50).default([]),
  })
  .refine((b) => (b.body ?? '').length > 0 || b.attachmentIds.length > 0, {
    message: 'Tin nhắn trống.',
    path: ['body'],
  });
export type SendMessageBody = z.infer<typeof SendMessageBody>;

export const EditMessageBody = z.strictObject({
  body: ChatBody.refine((s) => s.length > 0, { message: 'Tin nhắn trống.' }),
});
export type EditMessageBody = z.infer<typeof EditMessageBody>;

export const MarkReadBody = z.strictObject({ messageId: Uuid });
export type MarkReadBody = z.infer<typeof MarkReadBody>;

export const MuteBody = z.strictObject({ muted: z.boolean() });
export type MuteBody = z.infer<typeof MuteBody>;
