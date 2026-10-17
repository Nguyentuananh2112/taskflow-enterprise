import type { IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';

import type { Request, RequestHandler, Response } from 'express';

import {
  InvalidUploadNameError,
  PayloadTooLargeError,
  RateLimitedError,
  UnsupportedMediaTypeError,
} from '../../errors';
import { parseContentType, RAW_UPLOAD_CONTENT_TYPE } from '../../http/middleware';
import { requireUser } from '../../http/request-user';
import { decodeUploadName, sanitizeFileName } from '../domain/file-name';
import type { IFileStore, StagedFile } from '../ports';
import type { StorageQuota } from '../storage-quota';
import type { UploadSlots } from '../upload-slots';

/** Kết quả của `rawUpload` cho handler phía sau. Bản tạm tự `discard` khi response đóng (nếu chưa commit). */
export interface RawUpload {
  /** Tên đã làm sạch — chỉ để hiển thị / `filename*`, không bao giờ làm tên trên đĩa. */
  name: string;
  staged: StagedFile;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- cách chuẩn mở rộng Request của Express
  namespace Express {
    interface Request {
      upload?: RawUpload;
    }
  }
}

export interface RawUploadOptions {
  store: IFileStore;
  slots: UploadSlots;
  maxBytes: number;
  /** Không có byte nào trong khoảng này ⇒ cắt kết nối (ADR-141: 15 s; `UPLOAD_IDLE_TIMEOUT_MS` ở test). */
  idleTimeoutMs: number;
  /** Tổng thời gian tối đa của body (180 s). */
  totalTimeoutMs: number;
  /** Sau 413 giữa chừng: xả body tối đa chừng này rồi `destroy` (B: 5 s VÀ 2 MB). */
  drainTimeoutMs?: number;
  drainMaxBytes?: number;
  /** Mặc định `setTimeout` — test thay được. */
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  /** Trần kho `FILE_STORE_MAX_BYTES` ⇒ 507 TRƯỚC khi ghi bản tạm; commit cộng ngay vào số đã dùng. */
  quota?: StorageQuota;
}

export const DRAIN_TIMEOUT_MS = 5_000;
export const DRAIN_MAX_BYTES = 2 * 1024 * 1024;
const CONCURRENCY_RETRY_AFTER_SEC = 5;

class UploadTimeoutError extends Error {}
class ClientAbortedError extends Error {}

export function requireUpload(req: Request): RawUpload {
  if (!req.upload) throw new Error('rawUpload chưa chạy trước handler');
  return req.upload;
}

/**
 * Body nhị phân `application/octet-stream` (ADR-141): không multipart, không busboy/multer. Thứ tự: 415
 * (content-type) ⇒ 400 (`X-Upload-Name`) ⇒ 413 (`Content-Length` > trần, KHÔNG đọc byte nào) ⇒ 429 (≥ 3
 * upload đồng thời) ⇒ ghi bản tạm qua `IFileStore.stage` với đếm byte + timeout. Vượt trần giữa chừng ⇒
 * xóa tmp, 413 + `Connection: close`, xả có trần rồi hủy. Im lặng quá lâu / quá tổng ⇒ hủy kết nối.
 */
export function rawUpload(options: RawUploadOptions): RequestHandler {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  return (req, res, next) => {
    const { type } = parseContentType(req.headers['content-type']);
    if (type !== RAW_UPLOAD_CONTENT_TYPE) {
      rejectBody(req, res, options, setTimer); // B L1: đồng nhất với các nhánh từ chối khác
      next(new UnsupportedMediaTypeError('Chỉ chấp nhận Content-Type: application/octet-stream.'));
      return;
    }
    const decoded = decodeUploadName(req.headers['x-upload-name']);
    if (!decoded.ok) {
      rejectBody(req, res, options, setTimer);
      next(new InvalidUploadNameError());
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      rejectBody(req, res, options, setTimer);
      next(new PayloadTooLargeError());
      return;
    }
    const release = options.slots.tryAcquire(requireUser(req).id);
    if (!release) {
      rejectBody(req, res, options, setTimer);
      next(new RateLimitedError(CONCURRENCY_RETRY_AFTER_SEC));
      return;
    }
    res.once('close', release);

    const incoming = Number.isFinite(declared) && declared > 0 ? declared : options.maxBytes;
    (options.quota ? options.quota.ensure(incoming) : Promise.resolve())
      .then(() => receive(req, options, setTimer))
      .then(
        (staged) => {
          res.once('close', () => void staged.discard());
          req.upload = {
            name: sanitizeFileName(decoded.name),
            staged: counted(staged, options.quota),
          };
          next();
        },
        (err: unknown) => {
          if (err instanceof UploadTimeoutError || err instanceof ClientAbortedError) {
            req.destroy(); // client chậm / đã đi — không có ai nhận response
            return;
          }
          rejectBody(req, res, options, setTimer); // 413 giữa chừng, 507, lỗi đĩa… — body chưa đọc hết
          next(err);
        },
      );
  };
}

/** Bọc `commit` để cộng dung lượng vào `StorageQuota` ngay khi blob vào kho (đối soát sau mỗi `cacheMs`). */
function counted(staged: StagedFile, quota: StorageQuota | undefined): StagedFile {
  if (!quota) return staged;
  // Ủy quyền tường minh (không Object.create): LocalStagedFile có private field ⇒ phải gọi trên instance thật.
  return {
    get size() {
      return staged.size;
    },
    sizeBytes: staged.sizeBytes,
    sha256: staged.sha256,
    head: staged.head,
    read: (offset, length) => staged.read(offset, length),
    readAll: () => staged.readAll(),
    discard: () => staged.discard(),
    commit: async (key) => {
      const stored = await staged.commit(key);
      quota.add(stored.sizeBytes);
      return stored;
    },
  };
}

/** `req` ⇒ PassThrough ⇒ `store.stage`: lỗi của ta chỉ hủy PassThrough, `req` còn sống để trả 413. */
function receive(
  req: IncomingMessage,
  options: RawUploadOptions,
  setTimer: NonNullable<RawUploadOptions['setTimer']>,
): Promise<StagedFile> {
  const body = new PassThrough();
  const fail = (err: Error) => {
    req.unpipe(body);
    body.destroy(err);
  };
  // B L2: ổ ghi chậm (Defender) ⇒ backpressure ⇒ `req` bị pause, không phát `data` dù client vẫn gửi ⇒
  // không tính là im lặng; trần TỔNG thời gian vẫn áp dụng.
  const onIdle = () => {
    if (req.isPaused() || body.writableNeedDrain) idle = setTimer(onIdle, options.idleTimeoutMs);
    else fail(new UploadTimeoutError());
  };
  let idle = setTimer(onIdle, options.idleTimeoutMs);
  const total = setTimer(() => fail(new UploadTimeoutError()), options.totalTimeoutMs);
  const onData = () => {
    clearTimeout(idle);
    idle = setTimer(onIdle, options.idleTimeoutMs);
  };
  // `aborted` đã deprecated: `close` trước khi nhận đủ body (`complete`) = client hủy giữa chừng.
  const onClose = () => {
    if (!req.complete) fail(new ClientAbortedError());
  };
  const onError = () => fail(new ClientAbortedError());
  req.on('data', onData);
  req.once('close', onClose);
  req.once('error', onError);
  req.pipe(body);
  return options.store.stage(body, { maxBytes: options.maxBytes }).finally(() => {
    clearTimeout(idle);
    clearTimeout(total);
    req.off('data', onData);
    req.off('close', onClose);
    req.off('error', onError);
  });
}

/**
 * Không nhận body này: `Connection: close`, xả phần còn lại có trần (thời gian VÀ byte — B); chạm trần ⇒
 * `destroy`. Không xả thì client đang gửi không đọc được response (TCP RST); xả vô hạn thì kẻ xấu giữ socket.
 */
function rejectBody(
  req: IncomingMessage,
  res: Response,
  options: RawUploadOptions,
  setTimer: NonNullable<RawUploadOptions['setTimer']>,
): void {
  if (!res.headersSent) res.setHeader('Connection', 'close');
  if (req.readableEnded || req.destroyed) return;
  const maxBytes = options.drainMaxBytes ?? DRAIN_MAX_BYTES;
  let drained = 0;
  const timer = setTimer(() => req.destroy(), options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS);
  const onData = (chunk: Buffer) => {
    drained += chunk.length;
    if (drained > maxBytes) req.destroy();
  };
  req.on('data', onData);
  req.once('close', () => {
    clearTimeout(timer);
    req.off('data', onData);
  });
  req.resume();
}
