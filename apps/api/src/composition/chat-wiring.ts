import type { RequestHandler, Router } from 'express';

import type { IClock, IIdGenerator } from '../core/domain';
import { UploadByteBudget } from '../core/files/upload-byte-budget';
import type { HttpResponder } from '../core/http/envelope';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { ILogger } from '../core/logging/logger';
import {
  CHAT_PATH,
  createChatModule,
  noopChatNotifier,
  type IChatNotifier,
  type IChatUserRefs,
} from '../modules/chat/chat.module';
import { chatMedia, chatMediaResolver, chatUploadProcessor } from './chat-files';
import { chatSweepTask } from './chat-sweep';
import type { FilesBundle } from './files-setup';
import type { AvatarRefs } from './avatar-refs';
import type { Persistence } from './persistence';

/** Trần ADR-141: tệp chat 20 MB; 200 MB / người / ngày. */
export const CHAT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_UPLOAD_DAILY_BYTES = 200 * 1024 * 1024;

/** Cửa sổ / hạn mức chỉnh được ở APP_ENV=test (env.ts chặn nơi khác — F-01). */
export interface ChatSettings {
  editWindowSeconds?: number | undefined;
  sendHourly?: number | undefined;
  uploadDailyBytes?: number | undefined;
}

/** Biến test-only của env (`env.ts` chặn ngoài APP_ENV=test). */
export function chatSettingsFromEnv(env: {
  CHAT_EDIT_WINDOW_SECONDS?: number | undefined;
  CHAT_SEND_HOURLY?: number | undefined;
  CHAT_UPLOAD_DAILY_BYTES?: number | undefined;
}): ChatSettings {
  return {
    editWindowSeconds: env.CHAT_EDIT_WINDOW_SECONDS,
    sendHourly: env.CHAT_SEND_HOURLY,
    uploadDailyBytes: env.CHAT_UPLOAD_DAILY_BYTES,
  };
}

/**
 * Module chat (T-069) — chỉ khi có kho tệp (URL ảnh, upload); test HTTP cũ không có ⇒ không mount `/chat`. Tên + ảnh
 * người dùng: reader tên của Task + `avatarRefs` (T-068, một truy vấn / lô); realtime T-070 thay `notifier`.
 */
export function chatRouters(
  d: {
    files?: FilesBundle | undefined;
    chat?: ChatSettings | undefined;
    ids: IIdGenerator;
    clock: IClock;
    logger: ILogger;
  },
  x: {
    persistence: Persistence & { avatarRefs?: AvatarRefs | undefined };
    auth: { authenticate: RequestHandler };
    company: { sessionGate: { isActive(userId: string): Promise<boolean> } };
    responder: HttpResponder;
    limit: (rules: readonly RateLimitRule[]) => RequestHandler[];
    /** Giờ nghiệp vụ. */
    business: IClock;
    notifier?: IChatNotifier;
  },
): { path: string; router: Router }[] {
  if (!d.files) return [];
  const { files } = d;
  const { persistence } = x;
  const repos = persistence.chat;
  files.resolvers.register('chat', chatMediaResolver(repos, x.business));
  files.sweep.register(
    chatSweepTask({
      repos,
      store: files.store,
      uow: persistence.uow,
      businessClock: x.business,
      clock: d.clock,
      orphanTtlSec: files.orphanTtlSec,
    }),
  );
  const users: IChatUserRefs = {
    refsOf: async (ids) => {
      const unique = [...new Set(ids)];
      const [names, urls] = await Promise.all([
        persistence.task.users.findRefs(unique),
        persistence.avatarRefs?.urlsOf(unique) ?? new Map<string, string>(),
      ]);
      return new Map(
        [...names].map(([id, r]) => [
          id,
          { id, fullName: r.fullName, avatarUrl: urls.get(id) ?? null },
        ]),
      );
    },
  };
  const chat = createChatModule({
    repos,
    users,
    media: chatMedia(files.store, files.signer),
    notifier: x.notifier ?? noopChatNotifier,
    processor: chatUploadProcessor(files),
    budget: new UploadByteBudget(
      files.byteCounter,
      d.chat?.uploadDailyBytes ?? CHAT_UPLOAD_DAILY_BYTES,
      d.clock,
    ),
    uow: persistence.uow,
    ids: d.ids,
    clock: x.business,
    realClock: d.clock,
    logger: d.logger,
    responder: x.responder,
    limit: x.limit,
    authenticate: x.auth.authenticate,
    isCompanyActive: (id) => x.company.sessionGate.isActive(id),
    upload: files.upload(CHAT_FILE_MAX_BYTES),
    editWindowSeconds: d.chat?.editWindowSeconds,
    sendHourly: d.chat?.sendHourly,
  });
  return [{ path: CHAT_PATH, router: chat.router }];
}
