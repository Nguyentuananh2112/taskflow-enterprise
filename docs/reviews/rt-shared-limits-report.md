# rt-shared-limits — Báo cáo: hạn mức realtime theo user dùng chung qua Valkey (ADR-115)

**Người làm:** Engineer A · **Branch:** `feat/rt-shared-limits` (từ main `68e8e31`) · **Ngày:** 2026-10-16
**Căn cứ:** ADR-115, go-live §4.5, A3-report §6 mục 2–3; thiết kế được Tech Lead duyệt 2026-10-16 kèm 3
điều chỉnh (đồng hồ Valkey, không cluster, heartbeat theo lô) và Q1/Q2 (counter dùng chung, sửa go-live).

## 1. Đã làm

| Thành phần | Nội dung |
|---|---|
| `core/realtime/quota.ts` | Port `IRealtimeQuota` (`start`, `tryJoin`, `tryRenew`, `acquireSocket`, `releaseSocket`, `close`) + `LocalRealtimeQuota` = hành vi cũ (SlidingWindow theo user, trần 20 socket theo phòng user của instance). |
| `core/realtime/shared-quota.ts` | `SharedRealtimeQuota` bọc Local — **Local luôn kiểm trước**, cho qua mới đếm chung. Join/renew theo user: `createValkeyStore` (rate-limit-redis, `ResilientRedisStore` tự nạp lại script) với rule `rt-join-user` 60/phút, `rt-renew-user` 30/phút. Socket: Lua. `createRealtimeQuota(...)` cho composition root. |
| `core/realtime/shared-quota.scripts.ts` | Khóa + 3 Lua script (ACQUIRE / RELEASE / HEARTBEAT). |
| `core/realtime/gateway.ts`, `socket-handlers.ts`, `local-rooms.ts` | Gọi port thay cho SlidingWindow trực tiếp; trả suất ở `disconnect`; `userSocketCounts` (đếm phòng `user:` của adapter local) cho heartbeat. |
| `core/observability/metrics.ts` | `counter(name, help, label)` một nhãn (Q1) ⇒ `realtime_quota_fallback_total{kind}` (`socket`/`join`/`renew`/`heartbeat`). |
| `start-server.ts` | `createRealtimeQuota({ shared: env.SOCKET_REDIS_ADAPTER, … })` — 1 instance (mặc định) vẫn chỉ Local, không ghi gì vào Valkey. |
| `docs/runbook/security-go-live.md` §4.5 | Code đã có; tên log/metric; **Valkey single-node, không Cluster** + cách kiểm (`INFO cluster`); kiểm 21 socket trên staging (Q2 — B đọc khi review). |

### Cấu trúc trên Valkey

- `rt:sock:{userId}` — HASH `instanceId → số socket`, `PEXPIRE` 24 h, gia hạn mỗi lần ghi (không rò key).
- `rt:instances` — ZSET `instanceId → heartbeat cuối (ms, giờ Valkey)`; instance im > 1 h bị gỡ.
- **ACQUIRE** (Lua): `TIME` của Valkey; cộng các field của instance còn sống (heartbeat ≤ 30 s) + field
  của chính mình; field của instance chết bị `HDEL`; tổng ≥ 20 ⇒ từ chối, ngược lại `HINCRBY +1`.
- **RELEASE** (Lua): `HINCRBY −1`, về 0 ⇒ `HDEL`.
- **HEARTBEAT** mỗi 10 s (Lua theo lô 500 user/EVAL): `ZADD` bằng `TIME` + ghi lại số socket THẬT của
  instance cho mọi user đang có socket hoặc vừa về 0 (`HSET`/`HDEL`) ⇒ release bị mất (Valkey lỗi,
  socket bỏ đi giữa handshake) tự sửa ≤ 10 s; instance chết thôi được tính sau ≤ 30 s.
- `instanceId` = UUID mỗi lần khởi động (không hostname — container có thể trùng). `close()`: `HDEL`
  field của mình + `ZREM` (best-effort).

### Điều chỉnh của Tech Lead — đã áp dụng

1. **Đồng hồ:** heartbeat score và ngưỡng "còn sống" đều lấy `TIME` trong Lua; không dùng `Date.now()`
   của instance. Test "instance chết" lùi score theo `TIME` của Valkey.
2. **Cluster:** script đọc `rt:sock:{userId}` và `rt:instances` (khác slot) ⇒ ghi rõ **yêu cầu Valkey
   single-node / primary** trong code (`shared-quota.ts`, `shared-quota.scripts.ts`) và go-live §4.5
   (`INFO cluster` ⇒ `cluster_enabled:0`). Không tuyên bố "an toàn cluster".
3. **Heartbeat theo lô:** 1 EVAL / 500 user. **Đo trên Valkey test (6380): 1000 user = 2 EVAL, 8,5 ms**.

### Fail mode (ADR-115)

Valkey lỗi ở bất kỳ bước nào ⇒ **chỉ còn hạn mức Local** (cho qua nếu Local cho qua — trần 20 socket /
60 join / 30 renew **mỗi instance**, tức nhân N — chấp nhận có chủ đích, nhóm R5) + log `warn`
`realtime.quota_shared_unavailable_local_only` (≤ 1 lần/30 s mỗi loại) + metric mỗi lần. Kiểm quyền và
thu hồi không đổi (vẫn fail-closed — ADR-105).

## 2. Hành vi thay đổi

- **`project:join`:** trước — hạn mức theo socket chỉ tiêu một suất khi CẢ hạn mức theo user cho qua;
  nay — kiểm theo socket (đồng bộ) rồi mới `await` theo user; lần join bị chặn theo user vẫn tiêu một
  suất theo socket (30/phút/socket). Chặt hơn một chút, không có hướng lạm dụng. Từ sau `await` tới
  `pendingJoins.set` không còn `await` ⇒ kiểm số phòng + giữ suất vẫn nguyên tử (review B L1).
- 1 instance (`SOCKET_REDIS_ADAPTER=false`, mặc định v1): hành vi như cũ — `LocalRealtimeQuota`.

## 3. Test

| File | Nội dung |
|---|---|
| `shared-quota.test.ts` (unit, Valkey giả) | Local từ chối ⇒ không hỏi Valkey; Valkey lỗi ⇒ cho qua theo Local, metric mỗi lần, warn ≤ 1/30 s mỗi loại, Local vẫn chặn; heartbeat 1001 user ⇒ 3 EVAL; user về 0 ⇒ gửi 0 một lần rồi thôi; không user ⇒ vẫn 1 EVAL "còn sống". |
| `shared-quota.integration.test.ts` (Valkey thật, `VALKEY_URL_TEST`) | 2 instance cộng dồn chạm 20 ⇒ cả hai từ chối, trả suất ⇒ mở lại; instance chết (theo `TIME`) ⇒ không tính + dọn field; heartbeat sửa lệch +15 và xóa field khi về 0; join 30 + 30 qua 2 instance ⇒ lần 61 bị từ chối; heartbeat 1000 user (2 EVAL, < 1 s); **2 `RealtimeGateway` thật** trên 2 http server cùng Valkey: socket 21 của một user bị `RATE_LIMITED` dù nối sang instance kia, ngắt 1 socket ⇒ nhận lại được. |
| `metrics.test.ts` | `counter()` đếm theo nhãn. |
| `gateway.test.ts` (sẵn có, 54 test realtime) | Xanh không sửa — hành vi Local giữ nguyên. |

## 4. Kết quả lệnh

Worktree `D:\TaskFlow_wt\T-024`, base main `68e8e31` (chưa đổi lúc chạy), sau `pnpm install --frozen-lockfile`:

| Lệnh | Exit | Kết quả |
|---|---|---|
| `VITEST_MAX_WORKERS=2 VALKEY_URL_TEST=redis://127.0.0.1:6380/14 REQUIRE_INTEGRATION=1 pnpm verify` | **0** | lint 0 · typecheck 0 · test 0 (1720, gồm tầng I Valkey thật) · audit 0 |
| `vitest run src/core/realtime src/core/observability` (Valkey db 14, `REQUIRE_INTEGRATION=1`) | **0** | toàn bộ realtime + metrics, gồm 7 test Valkey thật của ticket |

Không đổi schema/Prisma ⇒ không chạy integration Postgres.

## 5. Rủi ro còn lại / câu hỏi mở

- **Cửa sổ handshake:** heartbeat ghi số socket theo phòng `user:` — socket đã acquire nhưng chưa vào
  phòng (vài ms) không được đếm ⇒ có thể đếm thiếu tạm thời ≤ số handshake đang chạy. Local vẫn giới hạn.
- **Instance chết đột ngột:** socket của nó còn được tính tới 30 s (đếm thừa ⇒ user có thể bị từ chối
  sớm trong 30 s). Chọn phía an toàn.
- **Valkey Cluster không hỗ trợ** — nếu sau này dùng cluster: đổi khóa sang hash tag chung
  (`rt:{q}:…`, dồn một slot) hoặc thiết kế lại; đã ghi go-live §4.5.
- Hạn mức `project:join` theo socket (30/phút) và `auth:renew` theo socket (5/phút) vẫn đếm trong bộ nhớ
  socket — gắn kết nối, không nhân theo instance (A3-report §6.3).
- `/readyz` (SlidingWindow theo instance) và tunnel `/monitoring` 300/phút/instance (R15) vẫn nhân N —
  ngoài phạm vi ticket này, B cập nhật threat-model (A3-report §6.3).
