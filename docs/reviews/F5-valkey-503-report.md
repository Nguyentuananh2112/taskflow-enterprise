# F5 (BACKLOG): 503 khi Valkey chậm (Engineer F)

**Ngày:** 2026-10-16 · **Nguồn:** SEC-34 (`cookie-tossing.sec.ts`, bước `register`) đỏ 503 một lần lúc máy chạy Stryker song song; chạy lại sạch thì xanh (TL). Log process API của lượt đỏ không được giữ lại, nên kết luận dưới đây dựa vào tái hiện tất định.

## Kết luận

**503 ở `login` / `register` / `refresh` khi Valkey chậm hoặc treo là fail-closed ĐÚNG THIẾT KẾ (ADR-108, ADR-074).** Đây không phải lỗi sản phẩm, và cũng không phải timeout của harness đặt quá chặt: harness không ghi đè hằng số nào.

Cơ chế (mã tại main 67d86ab):

1. Rule rate limit của `login` / `register` / `refresh` có `failMode: 'closed'` (`core/http/rate-limit/rules.ts`). Lệnh store Valkey lỗi thì `FailModeStore.increment` ném `ServiceUnavailableError`, nên API trả 503, handler không chạy (`store.ts`).
2. Client node-redis (`core/infrastructure/valkey.ts`): `socketTimeout: 3_000` ms, `pingInterval: 1_000`, `disableOfflineQueue: true`. Không nhận byte nào trong 3 s thì socket bị hủy. Trong lúc reconnect (backoff 100 ms·2ⁿ, trần 5 s), mọi lệnh **lỗi ngay**, không xếp hàng.
3. Vì vậy, Valkey treo (TCP còn mở nhưng không trả lời) **hoặc** event loop của process API (hay container Valkey) bị nghẽn > 3 s đều cắt socket và gây 503 ngắn ở 3 route fail-closed. Lượt SEC-34 đỏ thuộc trường hợp thứ hai: máy chạy Stryker concurrency 2 cùng lúc với suite.

## Tái hiện (tất định)

Snapshot riêng 9099703 = main 04d9b15 + merge `fix/sec-valkey-outage-ready` 5be07b5 (B), worktree `gE5`. Thêm **tạm** một ca vào cuối `valkey-outage.sec.ts` (không commit, đã gỡ; `git status` sạch). Ca này `docker pause` container Valkey tạm của suite (không phải compose dùng chung) trong 4 s:

| Bước | Lượt 1 | Lượt 2 |
|---|---|---|
| `register` trước khi pause | 201 | 201 |
| `register` khi Valkey treo | **503 sau 3413 ms** | **503 sau 3324 ms** |
| Hàm chờ của B (`waitValkeyReconnected`) trong lúc còn treo | không qua (đúng) | không qua (đúng) |
| Hàm chờ xong sau `docker unpause` | **114 ms** | **117 ms** |
| `register` sau khi chờ | 201 | 201 |

Độ trễ 503 khoảng 3,3–3,4 s khớp `socketTimeout` 3 s cộng chu kỳ ping 1 s. Hồi phục khoảng 0,1 s sau khi Valkey trả lời lại.

## Cổng cho fix của B (`fix/sec-valkey-outage-ready` @ 5be07b5)

- **Đọc logic: đúng.**
  - Phép thử `POST /auth/refresh` không cookie đi qua limiter `refresh-ip` fail-closed TRƯỚC handler, dùng cùng client và `disableOfflineQueue` như `register`. Nó không bị cache như `/readyz` (`READINESS_CACHE_MS` 1 s, nguyên nhân CI đỏ).
  - Request chưa xác thực mang `X-Forwarded-For` ngẫu nhiên, nên không tự ăn hết hạn mức.
  - Cần 2 lần 401 liên tiếp, nên chịu được lệnh đầu tiên lỗi ngay sau reconnect.
  - `beforeEach` chờ trước mọi ca, kể cả khi ca trước đỏ giữa chừng.
- `valkey-outage.sec.ts` ×3: **exit 0 ×3, 5/5 passed** mỗi lượt (30 s / 28 s / 26 s), không còn container tạm sót lại.
- Ca `docker pause` ở trên ×2: **exit 0 ×2** (6/6 kể cả ca tạm).

## Đề xuất (không bắt buộc), gửi A (chủ `core`)

- Cho `VALKEY_SOCKET_TIMEOUT_MS` cấu hình được qua env (mặc định giữ 3000), kèm ghi chú trong runbook: production có GC/CPU stall > 3 s sẽ thấy 503 ngắn ở login/register/refresh. Đó là cái giá chấp nhận của fail-closed, không phải sự cố bảo mật.
- Log `rate_limit.store_unavailable_fail_closed` (mức error) đã có, nên cảnh báo vận hành dựa được vào đó. Nên đưa vào bảng cảnh báo email (devops.md) nếu chưa có.
