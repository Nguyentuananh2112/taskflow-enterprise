import type { Server } from 'node:http';

import type { ILogger } from '../logging/logger';

export interface Closer {
  readonly name: string;
  close(): Promise<void> | void;
}

export interface GracefulShutdownOptions {
  server: Server;
  logger: ILogger;
  /** Chờ LB ngừng gửi request mới sau khi `/readyz` chuyển 503 (`READINESS_DRAIN_MS`). */
  drainMs: number;
  /** Hạn chót cứng (`SHUTDOWN_TIMEOUT_MS`) — quá hạn ⇒ `exit(1)`. */
  timeoutMs: number;
  /** Chạy ngay khi HTTP ngừng nhận kết nối mới — chỗ gắn Socket.io (`io.local.disconnectSockets`). */
  realtime?: readonly Closer[];
  /** Đóng theo thứ tự sau khi HTTP đóng xong: scheduler → prisma → pool → valkey. */
  resources?: readonly Closer[];
  exit?: (code: number) => void;
}

export interface GracefulShutdown {
  isShuttingDown(): boolean;
  /** Gọi lần 2 trở đi trả về cùng promise (no-op). */
  shutdown(reason: string, exitCode?: number): Promise<void>;
  /** SIGTERM/SIGINT ⇒ exit 0; unhandledRejection/uncaughtException ⇒ log fatal, exit 1. */
  installProcessHandlers(proc?: NodeJS.Process): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Trình tự tắt theo devops.md §7.3 (ADR-000: rolling deploy không rớt request). */
export function createGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const { server, logger, drainMs, timeoutMs, realtime = [], resources = [] } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;
  let pending: Promise<void> | undefined;

  const closeAll = async (closers: readonly Closer[]) => {
    for (const closer of closers) {
      try {
        await closer.close();
      } catch (err) {
        logger.error({ err, closer: closer.name }, 'shutdown.close_failed');
      }
    }
  };

  const run = async (reason: string, exitCode: number) => {
    shuttingDown = true;
    logger.info({ reason }, 'shutdown.start');
    const deadline = setTimeout(() => {
      logger.error({ reason, timeoutMs }, 'shutdown.forced');
      exit(1);
    }, timeoutMs);
    deadline.unref();

    await sleep(drainMs);
    const httpClosed = new Promise<void>((resolve) => server.close(() => resolve()));
    // `close()` chỉ đóng kết nối keep-alive đang nhàn rỗi TẠI thời điểm gọi; kết nối vừa trả xong
    // request đang chạy sẽ nhàn rỗi sau đó và giữ server mở tới keepAliveTimeout (65s) ⇒ quét lại.
    server.closeIdleConnections();
    const sweeper = setInterval(() => server.closeIdleConnections(), 50);
    await closeAll(realtime);
    await httpClosed; // chờ request đang chạy trả xong
    clearInterval(sweeper);
    await closeAll(resources);

    clearTimeout(deadline);
    logger.info({ reason, exitCode }, 'shutdown.complete');
    exit(exitCode);
  };

  return {
    isShuttingDown: () => shuttingDown,
    shutdown(reason, exitCode = 0) {
      pending ??= run(reason, exitCode);
      return pending;
    },
    installProcessHandlers(proc = process) {
      for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        proc.once(signal, () => void this.shutdown(signal, 0));
      }
      proc.on('unhandledRejection', (reason) => {
        logger.fatal({ err: reason }, 'process.unhandled_rejection');
        void this.shutdown('unhandledRejection', 1);
      });
      proc.on('uncaughtException', (err) => {
        logger.fatal({ err }, 'process.uncaught_exception');
        void this.shutdown('uncaughtException', 1);
      });
    },
  };
}
