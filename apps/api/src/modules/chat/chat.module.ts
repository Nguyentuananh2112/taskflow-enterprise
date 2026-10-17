import type { RequestHandler, Router } from 'express';

import type { HttpResponder } from '../../core/http/envelope';
import { chatSendRules, type RateLimitRule } from '../../core/http/rate-limit/rules';
import type { ChatDeps } from './application/chat-context';
import { ConversationQueries } from './application/conversation.queries';
import { GroupAdminUseCases } from './application/group-admin.use-cases';
import { MessageCommands } from './application/message-commands.use-cases';
import { MessageQueries } from './application/message.queries';
import { OpenConversationUseCases } from './application/open-conversation.use-cases';
import type { IChatConversationStore } from './application/ports/chat-conversation.port';
import type {
  IChatAttachmentStore,
  IChatMessageStore,
  IChatReadStateStore,
} from './application/ports/chat-message.port';
import type {
  IChatUploadProcessor,
  IUploadByteBudget,
} from './application/ports/chat-uploads.port';
import { SendMessageUseCase } from './application/send-message.use-case';
import { UploadUseCases } from './application/upload.use-cases';
import { ChatController } from './presentation/chat.controller';
import { chatRoutes } from './presentation/chat.routes';

export { CHAT_PATH } from './presentation/chat.routes';
export { noopChatNotifier } from './application/ports/chat-collaborators.port';
export { ChatRealtimeNotifier, type IChatEventSink } from './application/chat-realtime-notifier';
export type {
  ChatUserRef,
  IChatMedia,
  IChatNotifier,
  IChatUserRefs,
} from './application/ports/chat-collaborators.port';
export type { ChatDirectory } from './infrastructure/persistence/in-memory/in-memory-chat-state';

/** Store của module chat (T-069a — D): Prisma hoặc InMemory, cùng hợp đồng. */
export interface ChatRepositories {
  conversations: IChatConversationStore;
  messages: IChatMessageStore & IChatReadStateStore;
  attachments: IChatAttachmentStore;
}

/** Mặc định ADR-144: sửa ≤ 15 phút; gửi ≤ 600 / giờ. */
export const CHAT_DEFAULTS = { editWindowSeconds: 15 * 60, sendHourly: 600 } as const;

export interface ChatModuleDeps extends Omit<ChatDeps, keyof ChatRepositories> {
  repos: ChatRepositories;
  processor: IChatUploadProcessor;
  budget: IUploadByteBudget;
  responder: HttpResponder;
  limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
  authenticate: RequestHandler;
  isCompanyActive(userId: string): Promise<boolean>;
  /** `rawUpload` của kho tệp với trần tệp chat (20 MB). */
  upload: RequestHandler;
  editWindowSeconds?: number | undefined;
  sendHourly?: number | undefined;
}

export interface ChatModule {
  router: Router;
}

/** Composition của module chat (ADR-016, ADR-143…146). */
export function createChatModule(d: ChatModuleDeps): ChatModule {
  const deps: ChatDeps = { ...d, ...d.repos };
  const controller = new ChatController({
    open: new OpenConversationUseCases(deps),
    groups: new GroupAdminUseCases(deps),
    conversations: new ConversationQueries(deps),
    send: new SendMessageUseCase(deps),
    messages: new MessageCommands({
      ...deps,
      editWindowSeconds: d.editWindowSeconds ?? CHAT_DEFAULTS.editWindowSeconds,
    }),
    messageQueries: new MessageQueries(deps),
    uploads: new UploadUseCases({ ...deps, processor: d.processor, budget: d.budget }),
    responder: d.responder,
  });
  return {
    router: chatRoutes({
      controller,
      authenticate: d.authenticate,
      isCompanyActive: (id) => d.isCompanyActive(id),
      limit: d.limit,
      sendRules: chatSendRules(d.sendHourly ?? CHAT_DEFAULTS.sendHourly),
      upload: d.upload,
    }),
  };
}
