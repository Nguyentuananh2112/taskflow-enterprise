// Seed dữ liệu GIẢ cho môi trường dev (T-010 → Mốc 3.5 ADR-138). Chạy: `pnpm --filter @taskflow/api db:seed`.
// Xóa sạch dữ liệu cũ trước khi seed. Dữ liệu dựng ở seed-data.ts (test tầng I gọi chung).
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { Argon2idPasswordHasher } from '../src/modules/auth/infrastructure/security/argon2id-password-hasher';
import { seedDatabase } from './seed-data';

// eslint-disable-next-line no-restricted-properties -- script CLI ngoài app, không qua loadEnv của server
const { DATABASE_URL, NODE_ENV, APP_ENV, SEED_PASSWORD, CORS_ORIGINS } = process.env;
if (!DATABASE_URL) throw new Error('Thiếu DATABASE_URL');
if (NODE_ENV === 'production' || APP_ENV === 'production' || APP_ENV === 'staging') {
  throw new Error('Không seed dữ liệu giả vào production / staging');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/**
 * Mật khẩu chung của mọi user mẫu đã kích hoạt — CHỈ cho dev local (đã chặn production ở trên), qua được
 * PasswordPolicy (≥ 12 ký tự, không phổ biến, không chứa phần local của email). Đổi bằng SEED_PASSWORD.
 */
const DEV_PASSWORD = SEED_PASSWORD ?? 'TaskFlow-dev-2026';
/** Origin web cho link kích hoạt — như container: origin CORS đầu tiên. */
const WEB_ORIGIN = CORS_ORIGINS?.split(',')[0]?.trim() || 'http://localhost:3001';

try {
  // Băm một lần (argon2id ~46 MiB/lần, ADR-065) rồi dùng chung cho mọi user mẫu.
  const passwordHash = await (await Argon2idPasswordHasher.create()).hash(DEV_PASSWORD);
  const { activationLink } = await seedDatabase(prisma, { passwordHash, webOrigin: WEB_ORIGIN });
  console.info(
    [
      'Seed xong — Công ty Mẫu:',
      '  Admin: olivia@example.test · HR: pam@ · Kế toán: max@ · nhân viên: mia@, vic@, otto@ (mật khẩu dev chung)',
      '  Quinn đã nghỉ (chỉ còn nhiệm kỳ cũ) · Nina chờ kích hoạt — link (7 ngày, chỉ dev):',
      `  ${activationLink}`,
      '  2 workspace (Olivia chỉ ở "Nhóm Sản phẩm"), 2 project, 30 task; chấm công 5 ngày, 3 đơn nghỉ, 2 ngày lễ bịa.',
    ].join('\n'),
  );
} finally {
  await prisma.$disconnect();
}
