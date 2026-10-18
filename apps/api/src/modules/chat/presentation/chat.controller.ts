import type {
  AddGroupMembersBody,
  ChatPeopleQuery,
  CreateDirectBody,
  CreateGroupBody,
  EditMessageBody,
  ListConversationsQuery,
  ListMessagesQuery,
  MarkReadBody,
  MuteBody,
  RenameGroupBody,
  SendMessageBody,
  TransferOwnerBody,
  UploadQuery,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';
import * as z from 'zod';

import { requireUpload } from '../../../core/files/presentation/raw-upload';
import { decodeCursor, encodeCursor } from '../../../core/http/cursor';
import type { HttpResponder } from '../../../core/http/envelope';
import { requireUser } from '../../../core/http/request-user';
import type { ConversationQueries } from '../application/conversation.queries';
import type { GroupAdminUseCases } from '../application/group-admin.use-cases';
import type { MessageCommands } from '../application/message-commands.use-cases';
import type { MessageQueries } from '../application/message.queries';
import type { Opened, OpenConversationUseCases } from '../application/open-conversation.use-cases';
import type { SendMessageUseCase } from '../application/send-message.use-case';
import type { UploadUseCases } from '../application/upload.use-cases';

const CURSOR_KIND = 'chat-conversations';
const CursorKey = z.object({ at: z.iso.datetime(), id: z.uuid() });

export interface ChatControllerDeps {
  open: OpenConversationUseCases;
  groups: GroupAdminUseCases;
  conversations: ConversationQueries;
  send: SendMessageUseCase;
  messages: MessageCommands;
  messageQueries: MessageQueries;
  uploads: UploadUseCases;
  responder: HttpResponder;
}

type P = { id: string; userId?: string; wsId?: string };
const params = (req: Request) => req.params as P;
const actorOf = (req: Request) => requireUser(req).id;

/** Controller mỏng: parse xong ở `validate`; người thao tác luôn từ access token (ADR-146). */
export class ChatController {
  constructor(private readonly d: ChatControllerDeps) {}

  #opened(res: Response, out: Opened) {
    if (out.created) this.d.responder.created(res, out.conversation);
    else this.d.responder.ok(res, out.conversation);
  }

  people = async (req: Request, res: Response) => {
    const { q } = req.query as unknown as ChatPeopleQuery;
    this.d.responder.ok(res, await this.d.conversations.people(q));
  };

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListConversationsQuery;
    const key = query.cursor ? decodeCursor(query.cursor, CURSOR_KIND, CursorKey) : null;
    const page = await this.d.conversations.list({
      userId: actorOf(req),
      cursor: key && { at: new Date(key.at), id: key.id },
      limit: query.limit,
    });
    const next = page.next;
    this.d.responder.ok(res, page.items, {
      nextCursor: next
        ? encodeCursor(CURSOR_KIND, { at: next.at.toISOString(), id: next.id })
        : null,
      hasMore: next !== null,
      limit: query.limit,
    });
  };

  unreadCount = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.conversations.unreadCount(actorOf(req)));
  };

  direct = async (req: Request, res: Response) => {
    const { userId } = req.body as CreateDirectBody;
    this.#opened(res, await this.d.open.direct({ actorId: actorOf(req), userId }));
  };

  group = async (req: Request, res: Response) => {
    const body = req.body as CreateGroupBody;
    this.#opened(res, await this.d.open.group({ actorId: actorOf(req), ...body }));
  };

  workspace = async (req: Request, res: Response) => {
    const workspaceId = params(req).wsId ?? '';
    this.#opened(res, await this.d.open.workspace({ actorId: actorOf(req), workspaceId }));
  };

  detail = async (req: Request, res: Response) => {
    const conversationId = params(req).id;
    this.d.responder.ok(
      res,
      await this.d.conversations.detail({ userId: actorOf(req), conversationId }),
    );
  };

  rename = async (req: Request, res: Response) => {
    const { title } = req.body as RenameGroupBody;
    const out = await this.d.groups.rename({ ...this.#target(req), title });
    this.d.responder.ok(res, out);
  };

  addMembers = async (req: Request, res: Response) => {
    const { userIds } = req.body as AddGroupMembersBody;
    this.d.responder.ok(res, await this.d.groups.addMembers({ ...this.#target(req), userIds }));
  };

  removeMember = async (req: Request, res: Response) => {
    const userId = params(req).userId ?? '';
    this.d.responder.ok(res, await this.d.groups.removeMember({ ...this.#target(req), userId }));
  };

  transferOwner = async (req: Request, res: Response) => {
    const { userId } = req.body as TransferOwnerBody;
    this.d.responder.ok(res, await this.d.groups.transferOwner({ ...this.#target(req), userId }));
  };

  leave = async (req: Request, res: Response) => {
    await this.d.groups.leave(this.#target(req));
    res.status(204).end();
  };

  mute = async (req: Request, res: Response) => {
    const { muted } = req.body as MuteBody;
    await this.d.groups.setMuted({ ...this.#target(req), muted });
    res.status(204).end();
  };

  listMessages = async (req: Request, res: Response) => {
    const q = req.query as unknown as ListMessagesQuery;
    const page = await this.d.messageQueries.list({
      userId: actorOf(req),
      conversationId: params(req).id,
      ...q,
    });
    this.d.responder.ok(res, page.items, {
      nextCursor: null,
      hasMore: page.hasMore,
      limit: q.limit,
    });
  };

  sendMessage = async (req: Request, res: Response) => {
    const body = req.body as SendMessageBody;
    const out = await this.d.send.execute({ ...body, ...this.#target(req) });
    if (out.created) this.d.responder.created(res, out.message);
    else this.d.responder.ok(res, out.message);
  };

  editMessage = async (req: Request, res: Response) => {
    const { body } = req.body as EditMessageBody;
    const out = await this.d.messages.edit({
      actorId: actorOf(req),
      messageId: params(req).id,
      body,
    });
    this.d.responder.ok(res, out);
  };

  deleteMessage = async (req: Request, res: Response) => {
    await this.d.messages.delete({ actorId: actorOf(req), messageId: params(req).id });
    res.status(204).end();
  };

  markRead = async (req: Request, res: Response) => {
    const { messageId } = req.body as MarkReadBody;
    await this.d.messages.markRead({ ...this.#target(req), messageId });
    res.status(204).end();
  };

  upload = async (req: Request, res: Response) => {
    const { as } = req.query as unknown as UploadQuery;
    const { name, staged } = requireUpload(req);
    const out = await this.d.uploads.upload({ actorId: actorOf(req), name, as, staged });
    this.d.responder.created(res, out);
  };

  downloadUrl = async (req: Request, res: Response) => {
    const out = await this.d.uploads.downloadUrl({
      actorId: actorOf(req),
      attachmentId: params(req).id,
    });
    this.d.responder.ok(res, out);
  };

  #target(req: Request) {
    return { actorId: actorOf(req), conversationId: params(req).id };
  }
}
