import { pino, type DestinationStream, type Logger, type LevelWithSilent } from 'pino';

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
] as const;

export interface LoggerOptions {
  level: LevelWithSilent;
  gitSha: string;
  appEnv: string;
}

/** Logger JSON ra stdout (devops.md §6.1). `destination` chỉ dùng trong test. */
export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level,
      base: { gitSha: options.gitSha, appEnv: options.appEnv },
      redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
    },
    destination,
  );
}
