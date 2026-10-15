import { hash as argonHash, parseOptions, verify as argonVerify } from '@node-rs/argon2';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ARGON2ID_PARAMS, Argon2idPasswordHasher } from './argon2id-password-hasher';

let hasher: Argon2idPasswordHasher;
beforeAll(async () => {
  hasher = await Argon2idPasswordHasher.create();
});

describe('Argon2idPasswordHasher (ADR-065)', () => {
  it('dùng đúng tham số OWASP của ADR-065: argon2id m=47104 t=1 p=1', async () => {
    expect(ARGON2ID_PARAMS).toMatchObject({ memoryCost: 47104, timeCost: 1, parallelism: 1 });
    const hashed = await hasher.hash('correct-horse-12');
    expect(hashed.startsWith('$argon2id$v=19$m=47104,t=1,p=1$')).toBe(true);
  });

  it('verify đúng mật khẩu ⇒ true, sai ⇒ false', async () => {
    const hashed = await hasher.hash('correct-horse-12');
    expect(await hasher.verify(hashed, 'correct-horse-12')).toBe(true);
    expect(await hasher.verify(hashed, 'correct-horse-13')).toBe(false);
  });

  it('hai lần băm cùng mật khẩu cho kết quả khác nhau (có salt)', async () => {
    expect(await hasher.hash('correct-horse-12')).not.toBe(await hasher.hash('correct-horse-12'));
  });

  it('mật khẩu > 72 byte KHÔNG bị cắt: khác nhau sau byte 72 ⇒ verify false', async () => {
    const prefix = 'x'.repeat(80);
    const hashed = await hasher.hash(`${prefix}-a`);
    expect(await hasher.verify(hashed, `${prefix}-b`)).toBe(false);
    expect(await hasher.verify(hashed, `${prefix}-a`)).toBe(true);
  });

  it('mật khẩu tiếng Việt dài (> 72 byte) khác nhau ở cuối ⇒ false', async () => {
    const base = 'Mật khẩu rất dài của người dùng Việt Nam ';
    expect(new TextEncoder().encode(base).length).toBeGreaterThan(40);
    const hashed = await hasher.hash(`${base}${base}một`);
    expect(await hasher.verify(hashed, `${base}${base}hai`)).toBe(false);
  });

  it('NFC lúc hash và verify: băm dạng NFD, verify dạng NFC (và ngược lại) ⇒ true', async () => {
    const nfc = 'mật-khẩu-tiếng-việt'.normalize('NFC');
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(await hasher.verify(await hasher.hash(nfd), nfc)).toBe(true);
    expect(await hasher.verify(await hasher.hash(nfc), nfd)).toBe(true);
  });

  it('verify(null, …) vẫn chạy verify với hash giả rồi trả false (cân thời gian)', async () => {
    const impl = { hash: vi.fn(argonHash), verify: vi.fn(argonVerify) };
    const spied = await Argon2idPasswordHasher.create(impl);
    expect(impl.hash).toHaveBeenCalledTimes(1); // hash giả được tạo sẵn lúc create(), không lười
    expect(await spied.verify(null, 'correct-horse-12')).toBe(false);
    expect(impl.verify).toHaveBeenCalledTimes(1);
    const [dummyHash] = impl.verify.mock.calls[0] ?? [];
    expect(parseOptions(String(dummyHash))).toMatchObject({
      memoryCost: ARGON2ID_PARAMS.memoryCost,
      timeCost: ARGON2ID_PARAMS.timeCost,
      parallelism: ARGON2ID_PARAMS.parallelism,
    });
  });

  it('chuỗi hash hỏng ⇒ verify false, không ném lỗi', async () => {
    expect(await hasher.verify('not-a-phc-string', 'correct-horse-12')).toBe(false);
  });

  it('mật khẩu > 256 ký tự: verify trả false ngay, không gọi argon2 (chống DoS)', async () => {
    const impl = { hash: vi.fn(argonHash), verify: vi.fn(argonVerify) };
    const spied = await Argon2idPasswordHasher.create(impl);
    const hashed = await hasher.hash('correct-horse-12');
    expect(await spied.verify(hashed, 'x'.repeat(257))).toBe(false);
    expect(impl.verify).not.toHaveBeenCalled();
  });

  it('chuỗi khổng lồ (1 triệu ký tự): verify false / hash RangeError mà không chuẩn hóa NFC', async () => {
    const spy = vi.spyOn(String.prototype, 'normalize');
    try {
      const huge = 'x'.repeat(1_000_000);
      expect(await hasher.verify('$argon2id$v=19$m=1,t=1,p=1$AAAA$AAAA', huge)).toBe(false);
      await expect(hasher.hash(huge)).rejects.toThrow(RangeError);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('hash mật khẩu > 256 ký tự ⇒ RangeError (policy phải chặn trước đó)', async () => {
    await expect(hasher.hash('x'.repeat(257))).rejects.toThrow(RangeError);
  });

  describe('needsRehash (dùng parseOptions)', () => {
    it('hash cùng tham số ⇒ false', async () => {
      expect(hasher.needsRehash(await hasher.hash('correct-horse-12'))).toBe(false);
    });

    it.each([
      ['timeCost khác', { timeCost: 2 }],
      ['memoryCost khác', { memoryCost: 19456 }],
      ['argon2i thay vì argon2id', { algorithm: 1 as const }],
      ['parallelism khác (QA B.4)', { parallelism: 2 }],
      ['outputLen khác (QA B.4)', { outputLen: 48 }],
    ])('%s ⇒ true', async (_label, override) => {
      const old = await argonHash('correct-horse-12', { ...ARGON2ID_PARAMS, ...override });
      expect(hasher.needsRehash(old)).toBe(true);
    });

    it('chuỗi hỏng ⇒ true', () => {
      expect(hasher.needsRehash('garbage')).toBe(true);
    });
  });
});
