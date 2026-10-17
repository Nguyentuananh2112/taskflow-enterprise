# T-047 — OUTSIDE_RETENTION (ngày công ngoài thời hạn lưu) — báo cáo Engineer A

Nhánh `feat/T-047-outside-retention`, dựng trên `feat/T-046-totals` (TL d9). Nguồn: yêu cầu của B sau T-043b (R27),
TL d9 chốt + đính chính 2026-10-17.

## Hành vi

- CHỈ áp khi job retention thật sự chạy ở process: `isRetentionActive(env, persistence)` (maintenance-setup) = có
  bước dọn (Prisma) VÀ `retentionEnabled(env)` — MỘT điều kiện cho cả `maintenanceJobs` lẫn API. Job tắt (local/test
  mặc định) ⇒ mốc `null` ⇒ dữ liệu cũ hiện như thường, không chặn.
- Mốc = `recordsRetentionCutoff(retentionPolicyFrom(env), businessClock.now()).cutoffDate` — chính hàm của job, theo
  giờ nghiệp vụ (R31); so `date < mốc` trên `YYYY-MM-DD` như `work_date < cutoffDate` của job.
- Bảng công (me?month, HR, CSV): ngày < mốc ⇒ `RETENTION_EXPIRED` (ưu tiên cao nhất), không giờ / phép / phút / tên
  lễ; tổng tháng tính 0. CSV: "Quá thời hạn lưu".
- 422 `OUTSIDE_RETENTION`: ADJUSTMENT `date` < mốc; void lượt có `workDate` < mốc; PUT / DELETE ngày lễ `date` < mốc
  (kể cả OWNER có lý do). Thứ tự lỗi: 404 ws / 403 / luật self → 404 tài nguyên con (user, attendance_event) → 422.

## Review bảo mật (B @9344baf — APPROVE, không HIGH/MEDIUM)

| Mục | Mức | Xử lý |
|---|---|---|
| ADJUSTMENT kiểm 422 OUTSIDE_RETENTION trước 404 user | LOW-1 | Đã sửa: 404 user trước 422 (thứ tự lỗi đã chốt), có test. |
| Giữa lúc qua mốc và lượt job đêm đó, `GET /events` · `/me/events` cho ngày < mốc vẫn trả lượt chấm trong khi bảng công hiện RETENTION_EXPIRED | LOW-2 | TL chấp nhận, không sửa: IP/UA của các ngày đó đã bị scrub từ mốc 395 ngày, không lộ gì; job xóa ngay đêm đó. |

## Kiểm thử

- Unit (test viết trước) cả BẬT / TẮT: bảng tháng, HR, adjust, void, ngày lễ, check-in hôm nay, thứ tự 404 → 422;
  composition: cùng điều kiện với job, mốc theo số ngày của policy + giờ nghiệp vụ và trôi theo đồng hồ.
- Mutant tay: chặn adjust / void / ngày lễ, RETENTION_EXPIRED, biên `<` — đều chết; bỏ RETENTION_EXPIRED khỏi totals là
  tương đương (ô hết hạn vốn bằng 0).
