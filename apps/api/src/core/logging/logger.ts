/** Hàm log theo chữ ký pino: `log(obj, msg)` hoặc `log(msg)`. */
export interface LogFn {
  (obj: object, msg?: string): void;
  (msg: string): void;
}

/**
 * Port logger — application/core phụ thuộc vào đây, không gọi pino trực tiếp.
 * `pino.Logger` thỏa interface này (xem pino-logger.ts).
 */
export interface ILogger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child(bindings: Record<string, unknown>): ILogger;
}
