import type { IClock } from '../core/domain';
import { ActiveContentError, UnsupportedFileTypeError } from '../core/errors';
import { isFileKey } from '../core/files/domain/file-key';
import { extensionOf, sanitizeFileName } from '../core/files/domain/file-name';
import { inspectZip } from '../core/files/domain/inspect-zip';
import {
  isImageType,
  matchOfficeType,
  MIME,
  sniffType,
  type FileType,
} from '../core/files/domain/sniff-type';
import type { MediaUrlSigner } from '../core/files/media-url-signer';
import type { IFileStore, IImagePipeline, IMediaResolver, StagedFile } from '../core/files/ports';
import type { ChatRepositories, IChatMedia } from '../modules/chat/chat.module';
import type {
  IChatUploadProcessor,
  StoredChatUpload,
} from '../modules/chat/application/ports/chat-uploads.port';

/** D12 (ADR-147): tin + tệp chat giữ 12 tháng theo giờ nghiệp vụ. */
export const CHAT_RETENTION_DAYS = 365;
const DAY_MS = 86_400_000;
/** Ảnh chat (ADR-141): xem trước ≤ 1 600 px, thu nhỏ ≤ 320 px, giữ tỉ lệ; trần điểm ảnh chung 40 MP của worker. */
const IMAGE_VARIANTS = [
  { name: 'preview', size: 1600, fit: 'inside' },
  { name: 'thumb', size: 320, fit: 'inside' },
] as const;

/** Loại theo NỘI DUNG (không tin đuôi / Content-Type): sniff, ZIP ⇒ central directory + khớp đuôi. */
async function contentType(staged: StagedFile, name: string): Promise<FileType> {
  const ext = extensionOf(name);
  const sniffed = sniffType(staged.head, ext, staged.head.length === staged.sizeBytes);
  if (!sniffed.ok) throw new UnsupportedFileTypeError();
  if (sniffed.type !== 'zip') return sniffed.type;
  const verdict = await inspectZip(staged);
  if (!verdict.ok) {
    throw verdict.reason === 'MACRO_OR_ACTIVE_CONTENT'
      ? new ActiveContentError()
      : new UnsupportedFileTypeError();
  }
  if (!matchOfficeType(verdict.type, ext)) throw new UnsupportedFileTypeError();
  return verdict.type;
}

export function chatUploadProcessor(d: {
  store: IFileStore;
  pipeline: IImagePipeline;
}): IChatUploadProcessor {
  return {
    async process({ name: raw, as, staged }): Promise<StoredChatUpload> {
      const name = sanitizeFileName(raw);
      const type = await contentType(staged, name);
      const base = { name, sizeBytes: staged.sizeBytes, sha256: staged.sha256 };
      if (as === 'file') {
        const stored = await staged.commit('chat'); // lưu nguyên byte — chỉ tải xuống (`attachment`)
        return {
          ...base,
          kind: 'FILE',
          mime: MIME[type],
          width: null,
          height: null,
          fileKey: stored.key,
          previewKey: null,
          thumbKey: null,
        };
      }
      if (!isImageType(type)) throw new UnsupportedFileTypeError();
      const [preview, thumb] = await d.pipeline.transform(
        await staged.readAll(),
        type,
        IMAGE_VARIANTS,
      );
      await staged.discard(); // không giữ bản gốc ảnh gửi dạng ảnh (EXIF / GPS)
      if (!preview || !thumb) throw new Error('thiếu biến thể ảnh');
      const keys: string[] = [];
      try {
        for (const v of [preview, thumb]) {
          keys.push((await d.store.put(v.data, { maxBytes: v.data.length, key: 'chat' })).key);
        }
      } catch (err) {
        await deleteKeys(d.store, keys);
        throw err;
      }
      return {
        ...base,
        kind: 'IMAGE',
        mime: 'image/webp',
        width: preview.width,
        height: preview.height,
        fileKey: keys[0]!,
        previewKey: keys[0]!,
        thumbKey: keys[1]!,
      };
    },
  };
}

/** Xóa blob theo khóa đã kiểm regex (khóa lạ bị bỏ qua — không bao giờ chạm ngoài kho). */
export async function deleteKeys(store: IFileStore, keys: readonly string[]): Promise<void> {
  for (const key of new Set(keys)) if (isFileKey(key)) await store.delete(key);
}

export function chatMedia(store: IFileStore, signer: MediaUrlSigner): IChatMedia {
  return {
    imageUrls: (id) => ({
      previewUrl: signer.chatImageUrl(id, 'preview'),
      thumbUrl: signer.chatImageUrl(id, 'thumb'),
    }),
    downloadUrl: (id) => signer.downloadUrl(id),
    deleteBlobs: (keys) => deleteKeys(store, keys),
  };
}

/**
 * `/media/chat/:id/:variant` sau chữ ký (ADR-141, B M4): đính kèm còn gắn tin CHƯA xóa (xóa ⇒ 404 ngay —
 * SEC-CH-22), chưa quá 12 tháng; IMAGE ⇒ `preview` / `thumb` (inline), FILE ⇒ `file` (attachment + tên sạch).
 */
export function chatMediaResolver(
  repos: Pick<ChatRepositories, 'attachments'>,
  businessClock: IClock,
): IMediaResolver {
  return {
    async resolve({ id, variant, version }) {
      if (version !== 1) return null;
      const a = await repos.attachments.findById(id);
      if (!a || !(await repos.attachments.conversationOf(id))) return null;
      const cutoff = businessClock.now().getTime() - CHAT_RETENTION_DAYS * DAY_MS;
      if (a.createdAt.getTime() < cutoff) return null;
      const key =
        a.kind === 'IMAGE'
          ? variant === 'preview'
            ? a.previewKey
            : variant === 'thumb'
              ? a.thumbKey
              : null
          : variant === 'file'
            ? a.fileKey
            : null;
      if (!key || !isFileKey(key)) return null;
      return a.kind === 'IMAGE' ? { key, as: 'image' } : { key, as: 'download', name: a.name };
    },
  };
}
