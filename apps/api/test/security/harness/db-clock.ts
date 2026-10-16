import pg from 'pg';

import { loadHarnessConfig, postgresUrl } from './config';

/**
 * NGOẠI LỆ CÓ CHỦ ĐÍCH của luật "chỉ dựng dữ liệu qua API công khai" (cùng loại với
 * `flushRateLimitCounters`, chạm thẳng Valkey): API không có đồng hồ tua được, nên ca cần một refresh
 * token ĐÃ hết hạn (7 ngày / 30 ngày — SEC-20) lùi đúng một cột thời gian trong DB của suite.
 *
 * Giới hạn: chỉ `expires_at` / `family_expires_at`, chỉ token CÒN SỐNG của đúng một family (familyId =
 * claim `sid` của access token cùng phiên), chạy bằng migrator trên DB riêng của suite (ADR-106).
 * Không dùng để dựng dữ liệu nghiệp vụ — mọi thứ khác vẫn đi qua API.
 */
export async function backdateRefreshFamily(
  familyId: string,
  column: 'expires_at' | 'family_expires_at',
): Promise<number> {
  const config = loadHarnessConfig();
  const client = new pg.Client({
    connectionString: postgresUrl(config, 'migrator', config.dbName),
  });
  await client.connect();
  try {
    // `column` chỉ nhận 2 literal ở trên (kiểu) ⇒ ghép tên cột an toàn; giá trị đi qua tham số.
    const { rowCount } = await client.query(
      `UPDATE refresh_tokens SET ${column} = now() - interval '1 minute'
        WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
    return rowCount ?? 0;
  } finally {
    await client.end();
  }
}
