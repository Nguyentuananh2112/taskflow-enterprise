import { pino, type DestinationStream, type Logger, type LevelWithSilent } from 'pino';

import { requestContext } from '../context/request-context';
import { errorSerializer } from './error-serializer';

/**
 * Trường không bao giờ được ghi ra log (security.md §6.7, SEC-33). Wildcard `*.x` chỉ phủ
 * 1 cấp — thêm đường dẫn đầy đủ khi body lồng sâu hơn.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'currentPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  'passwordHash',
  '*.passwordHash',
  // Mốc 4 (payroll.md §6, SEC-PAY-09/14): số tiền không vào log — use case chỉ log id / kỳ; đây là lưới dự phòng.
  'baseSalary',
  '*.baseSalary',
  'netPay',
  '*.netPay',
  'seniorityPerYear',
  '*.seniorityPerYear',
  '*.lines',
  'overrideReason',
  '*.overrideReason',
  // Dự phòng (T-031 mục 0): lớp chính là serializer `err` theo allow-list — đường dẫn dưới chỉ bắt
  // lỗi Prisma lỡ được log dưới key khác `err` (dữ liệu dòng nằm trong cause.detail).
  'meta.driverAdapterError',
  '*.meta.driverAdapterError',
  '*.*.meta.driverAdapterError',
] as const;

export interface LoggerOptions {
  level: LevelWithSilent;
  gitSha: string;
  appEnv: string;
}

/** Stack (chỉ dòng frame) chỉ ra log ngoài staging/production. */
export const includeStackFor = (appEnv: string): boolean =>
  appEnv !== 'production' && appEnv !== 'staging';

/** Logger JSON ra stdout (devops.md §6.1). `destination` chỉ dùng trong test. */
export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level,
      base: { gitSha: options.gitSha, appEnv: options.appEnv },
      redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
      serializers: { err: errorSerializer({ includeStack: includeStackFor(options.appEnv) }) },
      // M3 (T-031): mọi log trong ngữ cảnh một request (access log, log của use case dùng logger
      // gốc, sự kiện bảo mật) mang `reqId` + `ip` (IP thật sau trust proxy).
      mixin: () => {
        const context = requestContext.get();
        if (!context) return {};
        return { reqId: context.requestId, ...(context.ip ? { ip: context.ip } : {}) };
      },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
