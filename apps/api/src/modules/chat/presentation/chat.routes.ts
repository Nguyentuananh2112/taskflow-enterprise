import {
  AddGroupMembersBody,
  AttachmentParams,
  ChatPeopleQuery,
  ConversationMemberParams,
  ConversationParams,
  CreateDirectBody,
  CreateGroupBody,
  EditMessageBody,
  ListConversationsQuery,
  ListMessagesQuery,
  MarkReadBody,
  MessageParams,
  MuteBody,
  RenameGroupBody,
  SendMessageBody,
  TransferOwnerBody,
  UploadQuery,
  WorkspaceConversationParams,
} from '@taskflow/contracts';
import { Router, type RequestHandler } from 'express';

import { SessionRevokedError } from '../../../core/errors';
import { RATE_LIMIT_RULES, type RateLimitRule } from '../../../core/http/rate-limit/rules';
import { requireUser } from '../../../core/http/request-user';
import { validate } from '../../../core/http/validate';
import type { ChatController } from './chat.controller';

export const CHAT_PATH = '/chat';

export interface ChatRouteDeps {
  controller: ChatController;
  authenticate: RequestHandler;
  /** Cổng công ty (ADR-135/146): người đã nghỉ / hết `access_until` ⇒ 401 `SESSION_REVOKED`. */
  isCompanyActive(userId: string): Promise<boolean>;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  /** Gửi tin: 30 / phút + 600 / giờ (`chatSendRules`). */
  sendRules: readonly RateLimitRule[];
  /** `rawUpload` với trần tệp chat 20 MB. */
  upload: RequestHandler;
}

/**
 * `/api/v1/chat/*` (avatar-chat.md §4). Thứ tự lỗi ADR-146: 401 (authenticate, cổng công ty) → 429 → 400 (validate)
 * → 404 (không phải người tham gia — use case) → 422 / 409. `no-store`: dữ liệu riêng tư theo người.
 */
export function chatRoutes(d: ChatRouteDeps): Router {
  const router = Router();
  const c = d.controller;
  const companyGate: RequestHandler = async (req, _res, next) => {
    if (!(await d.isCompanyActive(requireUser(req).id))) throw new SessionRevokedError();
    next();
  };
  const authed = [d.authenticate, companyGate, ...d.limit(RATE_LIMIT_RULES.authenticated)];
  const conv = validate({ params: ConversationParams });
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const people = [...authed, ...d.limit(RATE_LIMIT_RULES.chatPeople)];
  router.get('/people', ...people, validate({ query: ChatPeopleQuery }), c.people);
  router.get('/conversations', ...authed, validate({ query: ListConversationsQuery }), c.list);
  router.get('/unread-count', ...authed, c.unreadCount);
  router.post('/direct', ...authed, validate({ body: CreateDirectBody }), c.direct);
  const groupCreate = [...authed, ...d.limit(RATE_LIMIT_RULES.chatGroupCreate)];
  router.post('/groups', ...groupCreate, validate({ body: CreateGroupBody }), c.group);
  const wsParams = validate({ params: WorkspaceConversationParams });
  router.put('/workspaces/:wsId/conversation', ...authed, wsParams, c.workspace);

  router.get('/conversations/:id', ...authed, conv, c.detail);
  router.patch(
    '/conversations/:id',
    ...authed,
    validate({ params: ConversationParams, body: RenameGroupBody }),
    c.rename,
  );
  router.post(
    '/conversations/:id/members',
    ...authed,
    validate({ params: ConversationParams, body: AddGroupMembersBody }),
    c.addMembers,
  );
  router.delete(
    '/conversations/:id/members/:userId',
    ...authed,
    validate({ params: ConversationMemberParams }),
    c.removeMember,
  );
  router.put(
    '/conversations/:id/owner',
    ...authed,
    validate({ params: ConversationParams, body: TransferOwnerBody }),
    c.transferOwner,
  );
  router.post('/conversations/:id/leave', ...authed, conv, c.leave);
  router.put(
    '/conversations/:id/mute',
    ...authed,
    validate({ params: ConversationParams, body: MuteBody }),
    c.mute,
  );
  router.put(
    '/conversations/:id/read',
    ...authed,
    validate({ params: ConversationParams, body: MarkReadBody }),
    c.markRead,
  );

  router.get(
    '/conversations/:id/messages',
    ...authed,
    validate({ params: ConversationParams, query: ListMessagesQuery }),
    c.listMessages,
  );
  const send = [...authed, ...d.limit(d.sendRules)];
  router.post(
    '/conversations/:id/messages',
    ...send,
    validate({ params: ConversationParams, body: SendMessageBody }),
    c.sendMessage,
  );
  const edit = [...authed, ...d.limit(RATE_LIMIT_RULES.chatEdit)];
  router.patch(
    '/messages/:id',
    ...edit,
    validate({ params: MessageParams, body: EditMessageBody }),
    c.editMessage,
  );
  router.delete('/messages/:id', ...authed, validate({ params: MessageParams }), c.deleteMessage);

  // Upload: validate `?as=` TRƯỚC khi nhận body (sai ⇒ 400, không ghi tmp).
  const uploads = [
    ...authed,
    ...d.limit(RATE_LIMIT_RULES.chatUpload),
    validate({ query: UploadQuery }),
  ];
  router.post('/uploads', ...uploads, d.upload, c.upload);
  router.post(
    '/attachments/:id/download-url',
    ...authed,
    validate({ params: AttachmentParams }),
    c.downloadUrl,
  );
  return router;
}
