// Lỗi Prisma đúng hình dạng thật (probe T-031) cho test rò dữ liệu vào log / response.
export const LEAK_EMAIL = 'Leak.Me@Example.TEST';
export const LEAK_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const CHECK_MESSAGE =
  'new row for relation "users" violates check constraint "users_email_lowercase_chk"';

/**
 * Đúng hình dạng lỗi thật (probe T-031 trên Postgres 18 + Prisma 7.10 + adapter-pg): INSERT user có
 * email hoa vi phạm `users_email_lowercase_chk` ⇒ P2039, dữ liệu dòng nằm ở `cause.detail`.
 */
export function prismaCheckViolation() {
  const adapterError = Object.assign(new Error(CHECK_MESSAGE), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: '23514',
      originalMessage: CHECK_MESSAGE,
      kind: 'postgres',
      code: '23514',
      severity: 'ERROR',
      message: CHECK_MESSAGE,
      detail: `Failing row contains (01a13ee3-2535-72cb-8db7-585891a843bd, ${LEAK_EMAIL}, ${LEAK_HASH.slice(0, 64)}..., Leak, 0, null, null, null, 2026-10-15 09:27:16.024+00, 2026-10-15 09:27:16.024+00).`,
    },
  });
  return Object.assign(
    new Error(
      `\nInvalid \`prisma.user.create()\` invocation:\n\n\nDatabase error. Code: \`23514\`. Message: \`${CHECK_MESSAGE}\``,
    ),
    {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      clientVersion: '7.10.0',
      meta: { modelName: 'User', driverAdapterError: adapterError },
    },
  );
}

/** `PrismaClientValidationError`: message in cả cây tham số kèm giá trị (probe T-031). */
export function prismaValidationError() {
  return Object.assign(
    new Error(
      `\nInvalid \`prisma.user.create()\` invocation:\n\n{\n  data: {\n    email: "${LEAK_EMAIL}",\n    fullName: "X",\n    passwordHash: "${LEAK_HASH}",\n    tokenVersion: "nope"\n  }\n}\n\nArgument \`tokenVersion\`: Invalid value provided. Expected Int, provided String.`,
    ),
    { name: 'PrismaClientValidationError', clientVersion: '7.10.0' },
  );
}

/** Các mẩu dữ liệu nhạy cảm của fixture còn sót trong `value` (JSON) — rỗng là đạt. */
export const leakedSecrets = (value: unknown) => {
  const json = JSON.stringify(value);
  return [LEAK_EMAIL, LEAK_EMAIL.toLowerCase(), '$argon2', 'c29tZXNhbHRzb21lc2FsdA'].filter((s) =>
    json.includes(s),
  );
};
