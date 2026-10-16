/**
 * Khóa + Lua script của hạn mức realtime dùng chung (ADR-115) — xem `shared-quota.ts`. Mọi mốc thời
 * gian lấy `TIME` của Valkey. Script socket đọc 2 khóa khác hash slot ⇒ chỉ chạy trên Valkey
 * single-node / primary (không Cluster — CROSSSLOT).
 */
export const SOCKET_KEY = (userId: string) => `rt:sock:${userId}`;
export const INSTANCES_KEY = 'rt:instances';
/** Instance im lặng quá ngưỡng này (theo giờ Valkey) ⇒ socket của nó không còn được tính. */
export const INSTANCE_ALIVE_MS = 30_000;
export const HEARTBEAT_MS = 10_000;
/** HASH user không được ghi lại trong khoảng này ⇒ tự hết hạn (không rò key). */
export const SOCKET_HASH_TTL_MS = 24 * 60 * 60_000;
/** Instance im lặng quá lâu ⇒ gỡ khỏi ZSET (giữ ZSET nhỏ). */
export const INSTANCE_PRUNE_MS = 60 * 60_000;
/** Số user mỗi lần EVAL của heartbeat (một script theo lô, không một lệnh mỗi user). */
export const HEARTBEAT_BATCH = 500;

const NOW_MS = `local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)`;

/** KEYS: hash user, ZSET instance. ARGV: instanceId, limit, aliveMs, ttlMs. ⇒ 1 cấp / 0 từ chối. */
export const ACQUIRE_SCRIPT = `${NOW_MS}
local fields = redis.call('HGETALL', KEYS[1])
local total = 0
for i = 1, #fields, 2 do
  local inst, n = fields[i], tonumber(fields[i + 1])
  local seen = redis.call('ZSCORE', KEYS[2], inst)
  if inst == ARGV[1] or (seen and now - tonumber(seen) <= tonumber(ARGV[3])) then
    total = total + n
  else
    redis.call('HDEL', KEYS[1], inst)
  end
end
if total >= tonumber(ARGV[2]) then return 0 end
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1`;

/** KEYS: hash user. ARGV: instanceId. */
export const RELEASE_SCRIPT = `local n = redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
if n <= 0 then redis.call('HDEL', KEYS[1], ARGV[1]) end
return n`;

/**
 * KEYS: ZSET instance, rồi các hash user. ARGV: instanceId, ttlMs, pruneMs, rồi số socket từng user
 * (0 ⇒ HDEL). Ghi heartbeat theo giờ Valkey.
 */
export const HEARTBEAT_SCRIPT = `${NOW_MS}
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[3]))
for i = 2, #KEYS do
  local n = tonumber(ARGV[i + 2])
  if n > 0 then
    redis.call('HSET', KEYS[i], ARGV[1], n)
    redis.call('PEXPIRE', KEYS[i], ARGV[2])
  else
    redis.call('HDEL', KEYS[i], ARGV[1])
  end
end
return #KEYS - 1`;
