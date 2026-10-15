import { defineConfig } from 'vitest/config';

/** VITEST_MAX_WORKERS: số ("2") hoặc phần trăm ("50%"); không đặt ⇒ 4 (T-022). */
const envWorkers = process.env.VITEST_MAX_WORKERS;
const maxWorkers = envWorkers
  ? Number.isNaN(Number(envWorkers))
    ? envWorkers
    : Number(envWorkers)
  : 4;

export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
    // T-022: mặc định Vitest dùng (số CPU − 1) worker. Máy dev 12 luồng đang chạy nhiều phiên: 6 worker (50%)
    // ⇒ 16 file web không khởi động được worker ("Timeout waiting for worker"), 4 worker ⇒ xanh và nhanh gấp đôi.
    // Ghi đè bằng VITEST_MAX_WORKERS (vd máy yếu đặt 2). Worker chết / lỗi ngoài test ⇒ Vitest exit 1 dù vẫn in
    // "passed" (file không chạy được KHÔNG được đếm) ⇒ luôn xét EXIT CODE, không đọc chữ.
    maxWorkers,
  },
});
