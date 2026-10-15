import type { IClock, IIdGenerator, IRandom } from '../../src/core/domain';

/** `now()` cố định, tiến tay bằng `advance(ms)` / `set(date)` (test-spec §0.2). */
export class FakeClock implements IClock {
  #now: Date;

  constructor(now: Date | string = '2026-10-15T08:00:00.000Z') {
    this.#now = new Date(now);
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }

  set(now: Date | string): void {
    this.#now = new Date(now);
  }
}

/** Id xác định, đúng dạng UUID v7: `00000000-0000-7000-8000-000000000001`, `…002`, … */
export class SequentialIdGenerator implements IIdGenerator {
  #counter = 0;

  constructor(private readonly prefix = '00000000-0000-7000-8000-') {}

  next(): string {
    this.#counter += 1;
    return `${this.prefix}${this.#counter.toString(16).padStart(12, '0')}`;
  }
}

/** Hàng đợi giá trị định sẵn — hết hàng ⇒ ném lỗi rõ ràng thay vì trả giá trị ngẫu nhiên. */
export class FakeRandom implements IRandom {
  readonly #tokens: string[];
  readonly #ints: number[];
  readonly tokenRequests: number[] = [];

  constructor(values: { tokens?: string[]; ints?: number[] } = {}) {
    this.#tokens = [...(values.tokens ?? [])];
    this.#ints = [...(values.ints ?? [])];
  }

  token(byteLength: number): string {
    this.tokenRequests.push(byteLength);
    const value = this.#tokens.shift();
    if (value === undefined) throw new Error('FakeRandom: hết token định sẵn');
    return value;
  }

  int(min: number, max: number): number {
    const value = this.#ints.shift();
    if (value === undefined) throw new Error('FakeRandom: hết số nguyên định sẵn');
    if (value < min || value >= max) throw new Error(`FakeRandom: ${value} ngoài [${min}, ${max})`);
    return value;
  }
}
