// Port thời gian & ngẫu nhiên: domain/application không gọi `new Date()`, `crypto.*` trực tiếp
// để test xác định được (FakeClock, SequentialIdGenerator, FakeRandom ở test/support).

export interface IClock {
  now(): Date;
}

/** Sinh id cho entity mới — UUID v7 (data-and-api.md D9: tăng theo thời gian, B-tree ít phân mảnh). */
export interface IIdGenerator {
  next(): string;
}

export interface IRandom {
  /** `byteLength` byte ngẫu nhiên an toàn mật mã, mã hóa base64url (không padding). */
  token(byteLength: number): string;
  /** Số nguyên ngẫu nhiên trong [min, max). */
  int(min: number, max: number): number;
}
