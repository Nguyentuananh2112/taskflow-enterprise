/** Kiểu đầu ra của `compact`: key bắt buộc giữ nguyên, key có thể `undefined` thành optional thật. */
export type Compact<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/**
 * Bỏ các key có giá trị `undefined` (output của Zod `.optional()` là `T | undefined`) để truyền vào
 * use case khai báo `field?: T` dưới `exactOptionalPropertyTypes` — "không gửi" ≠ "gửi undefined".
 */
export function compact<T extends object>(input: T): Compact<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Compact<T>;
}
