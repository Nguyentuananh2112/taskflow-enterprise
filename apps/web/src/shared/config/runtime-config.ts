import * as z from 'zod';

// Cấu hình công khai nhận LÚC CHẠY (ADR-074, frontend.md §3.6): một image web cho mọi môi trường,
// không nhúng URL lúc build. Server đọc env, lọc giá trị công khai, truyền xuống client qua
// RuntimeConfigBoot; code không phải React (http client, socket) đọc đồng bộ qua getRuntimeConfig().

export const AppEnv = z.enum(['local', 'test', 'staging', 'production']);
export type AppEnv = z.infer<typeof AppEnv>;

/** Chỉ chứa giá trị được phép lộ ra trình duyệt — tuyệt đối không thêm secret (ADR-026). */
export const PublicRuntimeConfig = z.strictObject({
  /** Gồm cả tiền tố `/api/v1`, không có `/` cuối (devops.md §2.4). */
  apiUrl: z.url({ protocol: /^https?$/ }),
  /** Origin của API cho Socket.io, không có path. */
  wsUrl: z.url({ protocol: /^https?$/ }),
  appEnv: AppEnv,
});
export type PublicRuntimeConfig = z.infer<typeof PublicRuntimeConfig>;

let current: PublicRuntimeConfig | null = null;

/** Gọi một lần khi khởi động client. Gọi lại với cùng giá trị là vô hại (React StrictMode render 2 lần). */
export function setRuntimeConfig(config: PublicRuntimeConfig): void {
  current = PublicRuntimeConfig.parse(config);
}

export function getRuntimeConfig(): PublicRuntimeConfig {
  if (current === null) {
    // Lỗi lập trình: đọc cấu hình trước khi RuntimeConfigBoot chạy — không im lặng dùng mặc định.
    throw new Error('Runtime config chưa được khởi tạo (thiếu RuntimeConfigBoot ở root layout).');
  }
  return current;
}

/** Chỉ dùng trong test. */
export function resetRuntimeConfigForTest(): void {
  current = null;
}
