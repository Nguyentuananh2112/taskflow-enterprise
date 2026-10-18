import type { DownloadUrlDto, UploadResponseDto } from '@taskflow/contracts';

import type { StagedFile } from '../../../core/files/ports';
import { ResourceNotFoundError } from '../../../core/errors';
import type { ChatDeps } from './chat-context';
import type { IChatUploadProcessor, IUploadByteBudget, UploadAs } from './ports/chat-uploads.port';

export interface UploadDeps extends Pick<
  ChatDeps,
  'attachments' | 'conversations' | 'media' | 'uow' | 'ids' | 'clock' | 'realClock'
> {
  processor: IChatUploadProcessor;
  budget: IUploadByteBudget;
}

/**
 * `POST chat/uploads?as=` và `POST chat/attachments/:id/download-url` (ADR-141/144). Upload chưa gắn tin chỉ người
 * tải lên thấy (gắn khi gửi); upload mồ côi > 24 giờ bị `chat-retention` dọn.
 */
export class UploadUseCases {
  constructor(private readonly d: UploadDeps) {}

  async upload(input: {
    actorId: string;
    name: string;
    as: UploadAs;
    staged: StagedFile;
  }): Promise<UploadResponseDto> {
    await this.d.budget.consume(input.actorId, input.staged.sizeBytes);
    const stored = await this.d.processor.process(input);
    try {
      const record = await this.d.uow.run(() =>
        this.d.attachments.createUpload({
          id: this.d.ids.next(),
          uploaderId: input.actorId,
          createdAt: this.d.realClock.now(),
          ...stored,
        }),
      );
      return {
        uploadId: record.id,
        kind: record.kind,
        name: record.name,
        sizeBytes: record.sizeBytes,
        width: record.width,
        height: record.height,
      };
    } catch (err) {
      const keys = [stored.fileKey, stored.previewKey, stored.thumbKey];
      await this.d.media.deleteBlobs(keys.filter((k): k is string => !!k)).catch(() => undefined);
      throw err;
    }
  }

  /**
   * URL tải (purpose `download`, 60 s) — kiểm quyền LÚC BẤM: đính kèm phải gắn tin chưa xóa ở hội thoại người gọi còn
   * quyền; khác (kể cả upload chưa gắn, ảnh) ⇒ 404 như nhau (SEC-CH-02).
   */
  async downloadUrl(input: { actorId: string; attachmentId: string }): Promise<DownloadUrlDto> {
    const attachment = await this.d.attachments.findById(input.attachmentId);
    const conversationId = attachment && (await this.d.attachments.conversationOf(attachment.id));
    if (
      attachment?.kind !== 'FILE' ||
      !conversationId ||
      !(await this.d.conversations.canAccess(conversationId, input.actorId, this.d.clock.now()))
    ) {
      throw new ResourceNotFoundError('attachment');
    }
    return { url: this.d.media.downloadUrl(attachment.id) };
  }
}
