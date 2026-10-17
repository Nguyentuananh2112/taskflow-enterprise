# T-043 — Job retention dữ liệu cá nhân Mốc 3 (R27)

**Giao cho:** Engineer B · **Phase:** Mốc 3 (trước deploy) · **Phụ thuộc:** main ≥ a9a1516 (T-037b, T-038, T-039, T-040b)

## Nguồn
`docs/design/data-retention.md` §3 (phương án), §4 (cơ chế) · threat-model R27, R30 · mẫu job T-033 / G2 S2 (`purgeRefreshTokensJob`, `MaintenanceScheduler`, ADR-095).

## Việc
1. **Ngưỡng qua env** (đơn vị NGÀY — không mơ hồ như "tháng"), mặc định = phương án B; người dùng / TL chốt phương án khác thì chỉ đổi mặc định:

   | Env | Dữ liệu | Mặc định (B) | Min |
   |---|---|---|---|
   | `RETENTION_CLIENT_INFO_DAYS` | D1 IP/UA lượt chấm ⇒ NULL (mốc `occurred_at`) | 395 (≈ 13 tháng) | 30 |
   | `RETENTION_LEAVE_REASON_DAYS` | D3 lý do nghỉ + ghi chú quyết định của HR (`decision_note`, góp ý D) ⇒ NULL (mốc `end_date`; KHÔNG đụng đơn PENDING) | 395 | 30 |
   | `RETENTION_RECORDS_DAYS` | D2 lượt chấm, D4 đơn + số dư, D5 departures ⇒ DELETE | 730 (2 năm) | 365 |
   | `RETENTION_NOTIFICATIONS_DAYS` | D6 thông báo ⇒ DELETE | 180 | 30 |
   | `RETENTION_HR_AUDIT_DAYS` | D7 HrAuditLog ⇒ DELETE | 1826 (5 năm) | 365 |

   `min` chặn cấu hình nhầm (vd `0` xóa sạch). **Cờ riêng `RETENTION_JOB_ENABLED`** (TL chốt — dữ liệu bị xóa vĩnh viễn): APP_ENV local/test ⇒ chỉ chạy khi cờ này = `true` (cờ chung `MAINTENANCE_JOBS_ENABLED` không đủ — localhost của người dùng có dữ liệu thật); staging/production ⇒ cờ riêng nếu đặt, không thì theo cờ chung, mặc định bật.
2. **Ranh giới module** (quyết định L2 của T-040b: không module nào đọc/ghi bảng của module khác): mỗi module cung cấp **bước dọn** của bảng mình — một câu SQL theo lô (`… WHERE id IN (SELECT id … LIMIT n FOR UPDATE SKIP LOCKED)`), gọi TRONG transaction của lô:
   - attendance: scrub IP/UA (D1), xóa lượt chấm (D2);
   - leave: scrub lý do (D3, trừ PENDING), xóa đơn + số dư theo **cả năm** (D4): năm Y bị xóa khi 31/12/Y < mốc (`start_date < <năm của mốc>-01-01`, số dư `year < <năm của mốc>`). Không xóa giữa năm vì số ngày đã dùng được tính lại từ đơn (D-H3a) — xóa một phần làm sai số dư năm đó; đơn không kéo qua hai năm (`LEAVE_SPANS_YEARS`);
   - workspace: xóa departures (D5), xóa HrAuditLog (D7); bỏ khóa `note` (chữ tự do của người quản trị) khỏi `before` / `after` của HrAuditLog theo mốc `RETENTION_LEAVE_REASON_DAYS` (TL chốt — audit giữ 5 năm hành động / ai / khi nào / trước–sau, không giữ chữ tự do);
   - notifications: xóa thông báo (D6).
3. **Job `retention`** (composition, theo mẫu `purgeRefreshTokensJob`): 1 lượt/ngày + jitter, lượt đầu sau khởi động lệch khỏi các job khác. Mỗi lô một transaction, câu ĐẦU là `pg_try_advisory_xact_lock(hashtextextended('taskflow:retention', 0))` — không lấy được ⇒ `busy`, bỏ lượt. Các bước chạy lần lượt, mỗi bước tới khi lô < `batchSize` hoặc chạm trần lô của lượt. Idempotent; `signal` hủy (graceful shutdown) ⇒ dừng trước lô kế tiếp.
4. **Log / metrics:** chỉ số dòng mỗi bước, số lô, `busy`, `complete`, `aborted`, thời gian (`maintenance.run_done` sẵn có). KHÔNG log id, nội dung, ngưỡng dạng ngày cụ thể của người dùng nào.

## Ngoài phạm vi
Ẩn danh hóa tài khoản theo yêu cầu (đã có quy tắc ở `attendance-leave.md` §9); purge workspace (đã cascade); export lưu trữ CSV (công ty tự làm — R27 §2).

## Phạm vi sở hữu
`apps/api/src/composition/**` (job + wiring), `apps/api/src/config/env.ts` + `.env.example`, file purger mới (chỉ Prisma, như `refreshTokenPurger`) trong `modules/{attendance,leave,notifications,workspace}/infrastructure/**` — chủ module (A, D, G) review phần của mình.

## Test (tầng I trên Postgres, theo §4)
- Đúng ngưỡng ở biên: dòng cũ hơn ngưỡng 1 ngày ⇒ xử lý; trẻ hơn 1 ngày ⇒ không đụng (mỗi bước).
- D3: đơn PENDING quá hạn vẫn giữ lý do; đơn đã kết thúc ⇒ `reason` NULL, CHECK not-blank vẫn thỏa.
- D4: năm chưa hết hạn trọn vẹn giữ nguyên cả đơn lẫn số dư.
- Lô: nhiều hơn `batchSize` dòng ⇒ đủ qua nhiều lô; chạy lại ⇒ 0 thay đổi (idempotent).
- 2 instance cùng lúc ⇒ chỉ 1 bên làm (bên kia `busy`).
- `signal` hủy giữa lượt ⇒ dừng trước lô kế; không lỗi.
- Env: thiếu ⇒ mặc định B; dưới `min` ⇒ app không khởi động (env.test).

## Done
DoD + integration trên DB riêng (exit code, xin lượt TL). Nhắn `DONE T-043` + hash.
