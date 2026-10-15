import { API_DIR, startApi } from './api-process';
import { loadHarnessConfig } from './config';
import { prepareSuiteDatabase } from './database';
import { baseEnv } from './suite-env';

/**
 * Chuẩn bị hạ tầng MỘT lần trước mọi file (T-017c), timeout riêng — để test không đỏ vì lý do hạ tầng.
 *
 * Đo trên máy dev (findings §D): lần spawn Node đầu tiên sau quãng nghỉ mất ~31s (cache file của OS /
 * antivirus quét node_modules — nặng nhất ở worktree mới), lần sau ~1s; `prisma migrate` có checkpoint
 * mạng mất 35s (từng >120s), tắt checkpoint ~0.9s. Warm-up ở đây hấp thụ cả hai; các file sau dùng
 * timeout bình thường. Hạ tầng hỏng thật (DB/Valkey không tới được, migrate lỗi) ⇒ báo lỗi rõ ràng.
 */
export default async function setup(): Promise<void> {
  const timeoutMs = Number(process.env.SEC_WARMUP_TIMEOUT_MS ?? 300_000);
  const started = Date.now();
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[hạ tầng suite bảo mật] bước "${name}" lỗi — không phải lỗi test:\n${message}`,
        { cause: err },
      );
    }
  };

  const config = loadHarnessConfig(); // từ chối DB/cổng cấm (ADR-106) trước mọi kết nối
  const db = await step('chuẩn bị DB + migrate', () => prepareSuiteDatabase(config, API_DIR));
  try {
    const api = await step('warm-up process API', () =>
      startApi(baseEnv(db.appUrl), { readyTimeoutMs: timeoutMs }),
    );
    await api.stop();
  } finally {
    await db.release();
  }
  console.log(`[security-suite] warm-up xong trong ${Date.now() - started}ms (${API_DIR})`);
}
