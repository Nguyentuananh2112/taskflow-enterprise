# T-047 — OUTSIDE_RETENTION (ngày công ngoài thời hạn lưu) — báo cáo Engineer A

Nhánh `feat/T-047-outside-retention`, dựng trên `feat/T-046-totals` (TL d9). Nguồn: yêu cầu của B sau T-043b (R27),
TL d9 chốt + đính chính 2026-10-17.

## Trạng thái

**Đã vào main** (2026-10-17) qua nhánh web của E: `7eb8fb4` (Merge feat/T-046-attendance-calendar c4f4bea), cuối chuỗi
`eee812c`. TL: verify + E2E xanh.

| Nhánh | Commit (sau rebase lên `2af333a`) |
|---|---|
| `feat/T-046-totals` | `e417691` totals me?month + HR · `a160e66` ADJUSTMENT / void trả totals |
| `feat/T-047-outside-retention` | `878f38d` OUTSIDE_RETENTION · `387c353` LOW-1 + report · `9bf8ea4` nhãn "Ngoài thời hạn lưu" |

Rebase lên `2af333a` (đã có CC-HR-02 `d6ac8f7` + T-045) sạch, không xung đột. Sau rebase (exit code):
`install --frozen-lockfile` 0 · `prisma generate` 0 · `typecheck` 0 · `lint` 0 · `lint:deps` api 0 / web 0 ·
`check-env-example` 0 · `pnpm test` 0. Verify / integration / security / E2E do TL chạy ở lượt merge.

## Hành vi

- CHỈ áp khi job retention thật sự chạy ở process: `isRetentionActive(env, persistence)` (maintenance-setup) = có
  bước dọn (Prisma) VÀ `retentionEnabled(env)` — MỘT điều kiện cho cả `maintenanceJobs` lẫn API. Job tắt (local/test
  mặc định) ⇒ mốc `null` ⇒ dữ liệu cũ hiện như thường, không chặn.
- Mốc = `recordsRetentionCutoff(retentionPolicyFrom(env), businessClock.now()).cutoffDate` — chính hàm của job, theo
  giờ nghiệp vụ (R31); so `date < mốc` trên `YYYY-MM-DD` như `work_date < cutoffDate` của job.
- Bảng công (me?month, HR, CSV): ngày < mốc ⇒ `RETENTION_EXPIRED` (ưu tiên cao nhất), không giờ / phép / phút / tên
  lễ; tổng tháng tính 0. CSV: "Ngoài thời hạn lưu".
- 422 `OUTSIDE_RETENTION`: ADJUSTMENT `date` < mốc; void lượt có `workDate` < mốc; PUT / DELETE ngày lễ `date` < mốc
  (kể cả OWNER có lý do). Thứ tự lỗi: 404 ws / 403 / luật self → 404 tài nguyên con (user, attendance_event) → 422.

- Web (E, T-046 calendar): ô RETENTION_EXPIRED dùng nhãn "Ngoài thời hạn lưu"; thông điệp tiếng Việt cho 422
  OUTSIDE_RETENTION ở `ec7e436` (fix/T-043b-retention-web). `timesheet-cache` không tự cộng tổng — lấy `totals` server.

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
