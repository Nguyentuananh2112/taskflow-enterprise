export type StorageKind = 'memory' | 'prisma';

/** Mọi module cùng một loại lưu trữ (T-020: không chạy lai). */
export const allModules = (kind: StorageKind) =>
  ({
    auth: kind,
    workspace: kind,
    task: kind,
    notifications: kind,
    company: kind,
    attendance: kind,
    leave: kind,
    hrProfile: kind,
    chat: kind,
  }) as const;

/**
 * Quyết định Tech Lead (T-020): staging/production từ chối khởi động nếu BẤT KỲ module nào chạy
 * bộ nhớ (kể cả trạng thái "lai"). Local/test: trả danh sách module đang chạy bộ nhớ để cảnh báo.
 * Kiểm theo module THỰC SỰ đã wire (không chỉ theo biến môi trường) — module mới (Task — T-024)
 * phải khai `modules.task`.
 */
export function assertPersistenceAllowed(
  appEnv: 'local' | 'test' | 'staging' | 'production',
  modules: Readonly<Record<string, StorageKind>>,
): string[] {
  const inMemory = Object.entries(modules)
    .filter(([, kind]) => kind === 'memory')
    .map(([name]) => name)
    .sort();
  if (inMemory.length > 0 && (appEnv === 'staging' || appEnv === 'production')) {
    throw new Error(
      `Lưu trữ bộ nhớ không được dùng ở ${appEnv} (module: ${inMemory.join(', ')}) — cần repository Prisma.`,
    );
  }
  return inMemory;
}
