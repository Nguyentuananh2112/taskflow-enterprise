// Cấu hình Prisma CLI 7.10 (stack-versions §8.1, ADR-061/062). Chạy CLI bằng `pnpm exec prisma`.
import { defineConfig } from 'prisma/config';

// Prisma 7 không tự nạp .env; dùng loader có sẵn của Node 24 (không thêm dotenv). Thiếu file là bình thường
// (CI/Docker truyền biến qua môi trường thật).
try {
  process.loadEnvFile('.env');
} catch {
  // không có .env
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // KHÔNG dùng env('DATABASE_URL'): nó ném lỗi khi biến vắng mặt ⇒ `prisma generate` ở stage build Docker
  // sẽ hỏng. Fallback "" đủ cho generate; migrate/seed lúc chạy luôn có DATABASE_URL thật (ADR-061).
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
