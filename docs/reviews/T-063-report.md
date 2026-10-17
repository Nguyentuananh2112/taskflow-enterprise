# T-063 — Chấm công sang cấp công ty — báo cáo Engineer A

Nhánh `feat/T-063-attendance-company`, dựng trên `feat/T-061-company-core` @fbbf71f (B). Merge vào nhánh tích hợp
`feat/company-level`, **không** vào `main`. Nguồn: `docs/design/company-level.md` v2.1 (người dùng duyệt 17/10) — ADR-133
(nhiệm kỳ bằng ngày), ADR-134 (Admin không phải nhân viên), ADR-135 (thứ tự lỗi), ADR-136 (chấm công thuộc công ty).

## Commit

| Commit | Nội dung |
|---|---|
| `69fe18e` | domain: `tenure.ts` theo NGÀY; `decidePunch` thuần (`punch-rules.ts`, IN ngoài nhiệm kỳ ⇒ `NOT_EMPLOYED`); `localToday` xuống domain; `lockUserPunch` (từ T-053a @62fcc74) |
| `56fd628` | test diệt mutant mới (OUT mồ côi; `localToday` chọn phiên bản mới nhất) |
| `83bf1c6` | module attendance không còn `workspaceId`: port, store Prisma + in-memory, use case, route `/api/v1/attendance`, contracts params, OpenAPI, harness + test |
| `54d402a` | composition: persistence + `wireAttendance` (module company của B, `LateApprovedLeavePort`), mount route; gỡ attendance khỏi `tsconfig.exclusions.json`; test HTTP viết lại |

(Commit `78884e3` — `truncateAll` dọn `holidays`/`companies` — B đã gộp vào T-061, bỏ khi rebase.)

## Hành vi

- **Phạm vi:** một công ty, một bộ lịch (phiên bản, `effective_from` unique) + ngày lễ (PK `date`) + múi giờ trong phiên
  bản. Không bảng nào của attendance có `workspace_id`.
- **Nhiệm kỳ** = `ICompanyTenurePort` (khớp `ICompanyTenureReader` của B): đoạn EMPLOYEE `{from, until}` **bằng ngày**,
  gồm hai đầu — ngày sau `last_day` không còn trong nhiệm kỳ (A C1). Admin không có nhiệm kỳ (không phải nhân viên).
- **Chấm vào / ra** (`POST /attendance/check-in|out`): khóa `taskflow:attendance:punch:<user>` → `assertActiveEmployee`
  (A C2 — nghỉ việc hoàn tất trong lúc chờ khóa ⇒ 401 `SESSION_REVOKED`, không ghi) → `decidePunch`: IN ngoài nhiệm kỳ ⇒
  422 `NOT_EMPLOYED` (trước ngày đầu; 00:00–06:00 sau ngày cuối — A S1); OUT giữ luật 06:00; mã cũ giữ nguyên.
- **ADJUSTMENT** (A S2): chưa từng là nhân viên (gồm Admin) ⇒ 404 `user`; người đã nghỉ, ngày thuộc nhiệm kỳ cũ ⇒ được;
  ngoài mọi nhiệm kỳ ⇒ 422 `NOT_EMPLOYED` (sau `OUTSIDE_RETENTION`). Luật self **tuyệt đối** (Admin cũng không tự xử lý).
- **Bảng HR / CSV:** roster = nhiệm kỳ EMPLOYEE giao khoảng + người có lượt chấm (R30); `left` = không còn nhiệm kỳ mở.
- **Lịch / lễ:** đọc bằng `attendance:self` HOẶC `hr:manage` (Admin đọc được); ghi `hr:manage`; lễ quá khứ chỉ Admin + lý do.
- **Route** `/api/v1/attendance/*`: `permitCompany` (quyền công ty hiện tại — `company.permissionsOf`, đã áp `access_until`):
  không thuộc công ty ⇒ 401 `SESSION_REVOKED` → thiếu quyền 403 → 400 (permit trước validate — ADR-135).

## Kiểm tra (exit code)

| Lệnh | Kết quả |
|---|---|
| `tsc --noEmit` (api, sau gỡ loại tạm) | 0 |
| eslint file đổi · `lint:deps` api | 0 · 0 (502 module) |
| `vitest --project api` (2 worker) | 0 — 140 file / 1479 test |
| vitest `test/http` + `src/composition` | 0 — 20 file / 161 test |
| Stryker `attendance-domain` (lượt TL cấp, trên 7cbcc19 + test) | 95,56 % (2 survivor mới là EQ: punch-rules:41, work-schedule:72) |
| integration LSP attendance (DB riêng, lượt TL cấp, trước rebase lên fbbf71f) | 0 — 5 file / 69 test (lượt đầu 7 đỏ do `truncateAll` — đã sửa) |
| `check-temp-exclusions.mjs` | còn đỏ — chỉ mục leave (D, T-064) + suite bảo mật HR (F, T-066) |

Kiểm ngược: bỏ `assertActiveEmployee` ⇒ 2 test đỏ (C2, Admin chấm); mutant luật chấm — Stryker trên.

**Chưa chạy sau rebase lên fbbf71f:** integration LSP (cần lượt máy) — TL chạy trong cổng gộp.

## Quyết định tự đưa ra

- `LateApprovedLeavePort`: trước khi leave được nối (T-064) trả **rỗng** (không ném lỗi) để T-063 xanh độc lập trên nhánh
  tích hợp; D `bind` port của leave trong container ở T-064. Cổng gộp đòi danh sách loại rỗng ⇒ không thể quên.
- `ForbiddenError(required)` cho route đọc lịch ghi `"attendance:self | hr:manage"`.
- Tenure query của check-in: `[hôm nay − 2, hôm nay + 1]` (đủ cho IN theo múi giờ lịch và OUT luật 06:00).

## Rủi ro / việc cho người khác

- **D (T-064):** gọi `approvedLeaves.bind(leave.approvedLeaves)` sau khi dựng leave trong container (biến `approvedLeaves`
  cục bộ trong `createContainer`).
- **F (T-066):** suite SEC/CLK HR theo ws còn trong danh sách loại; viết lại theo công ty (company-level §6).
- **E (T-065):** route web đổi sang `/api/v1/attendance/*`; contracts `AttendanceEventParams` / `HolidayDateParams` bỏ `wsId`.
