# T-065b — Nhân viên, kích hoạt tài khoản, Quản trị (web) — báo cáo Engineer E

Nhánh `feat/T-065b-hr-admin` (worktree T-025), đi tiếp từ `feat/T-065a-company-home` @e8b36b2 (cần trang chính, header, guard công ty của T-065a). Contracts B `1bb5f42`. Merge vào `feat/company-level` SAU T-065a. Chưa push.

| Commit | Nội dung |
|---|---|
| `c155e60` | mock-api: nhân viên, kích hoạt, quản trị, công ty (+ 6 ca test mock) |
| `86951be` | `/hr/employees` — thêm + hộp link một lần, tạo lại link, cho nghỉ / hủy lịch, nhận lại |
| `40e8b8d` | `/activate` ngoài gate |
| `820d491` | `/admin`, `/admin/access`, `/admin/workspaces`, `/admin/company` |

## Đã làm

- **entities/company**: `employeesApi`, `adminApi`, key `['company', 'hr'|'admin'|'info', …]`, hook, nhãn trạng thái / quyền. `authApi.inspectActivation` / `activate` (token trong body, không bao giờ trong URL).
- **`/hr/employees`** (`hr:manage`): lọc theo trạng thái (`?status=`), tìm ≥ 2 ký tự, mỗi dòng MỘT nút theo trạng thái (Tạo lại link · Cho nghỉ việc · Hủy lịch nghỉ · Nhận lại); HR với chính mình / người giữ grant ⇒ "Quản trị viên xử lý" (server vẫn 403). Thêm nhân viên: email, họ tên, ngày vào (mặc định hôm nay theo server, lùi ≤ 31 ngày) + cảnh báo ngày làm đã qua sẽ là vắng. **Hộp link MỘT lần**: sao chép / chia sẻ (`navigator.share`), "hết ngày dd/mm", đóng khi chưa sao chép ⇒ cảnh báo, bấm lại mới đóng. Cho nghỉ việc: ngày làm cuối [hôm nay − 31, + 90], lý do; xong ⇒ hiện cảnh báo của server (đơn chờ, workspace sẽ mồ côi). Lối vào "Danh sách nhân viên" từ `/hr`.
- **`/activate`** (công khai, `app/activate` — ngoài GuestGate/AuthGate; `Referrer-Policy: no-referrer`): fragment `#t=` đọc một lần / lượt tải (useSyncExternalStore, cache), `history.replaceState` xóa NGAY trước mọi request, không lưu web storage; tải lại ⇒ "Hãy mở lại link trong tin nhắn…"; đang đăng nhập người khác ⇒ "Bạn đang đăng nhập là X — Đăng xuất…", không tự chuyển; chỉ gọi `inspect` (chỉ đọc) khi là khách; form có tên đăng nhập + ô `autocomplete=username` ẩn, `PasswordInput`; 422 ⇒ lỗi dưới ô, token còn sống; 400/410 ⇒ một câu "Link không còn hiệu lực — xin bộ phận nhân sự link mới"; 429 ⇒ "thử lại sau 15 phút"; xong ⇒ phiên mới, toast, `/w`. Sentry web vốn đã cắt `?`/`#` và bỏ breadcrumb — thêm ca test khẳng định `/activate#t=…` bị cắt.
- **`/admin`** (`company:admin`): 3 ô lớn. **Phân quyền**: mỗi người một dòng — chọn vai trò, ô quyền cấp thêm (tắt khi Quản trị viên), "Lưu" theo dòng với `expectedVersion`; câu lời thường cho last_admin / xung đột version / grant cho Admin; đổi chính mình ⇒ làm mới `/auth/me`. **Workspace**: tên, chủ sở hữu, số thành viên, cờ Mồ côi / Đã xóa / Đã lưu trữ; mồ côi còn người ⇒ "Giao chủ sở hữu"; mồ côi không còn ai ⇒ "Lưu trữ" (xác nhận). **Thông tin công ty**: tên (version), header đổi theo.
- **Mock-api**: `MockCompany` thêm ngày vào, version, departures, lịch nghỉ, token (chỉ SHA-256, một token sống / người); handler `hr/employees*`, `auth/activation/*`, `admin/*`, `company`; login từ chối người chờ kích hoạt / đã nghỉ.
- Selector cho F (E2E T-066) đã gửi F; tên trong code khớp tin đó.

## Quyết định tự đưa ra / giả định (chờ B xác nhận — đã hỏi)

1. **Giao OWNER**: v2.1 = giao cho thành viên CÒN LẠI, nhưng contracts không có danh sách thành viên của workspace mồ côi (Admin không là thành viên). Tạm: chọn từ nhân viên công ty, server trả 422 `NOT_WORKSPACE_MEMBER` nếu không phải thành viên. Đã đề xuất B: `GET admin/workspaces/:id/members` hoặc `members` trong `AdminWorkspaceDto` khi orphan.
2. Mock giả định: `DELETE …/offboarding` ⇒ 200 `EmployeeDto`; ngày ngoài khoảng ⇒ 422 `START_DATE_OUT_OF_RANGE` / `LAST_DAY_OUT_OF_RANGE`; tạo lại link cho người đã kích hoạt ⇒ 422 `ALREADY_ACTIVATED`; mật khẩu yếu ⇒ 422 `VALIDATION_ERROR` + `details.issues[path=password]`.
3. Cảnh báo ngày vào trong quá khứ **không ghi số N ngày** (web không chắc lịch làm việc của từng ngày) — ghi "những ngày làm việc từ dd/mm đến hôm qua sẽ tính là vắng".
4. Mock hoàn tất nghỉ việc ngay khi ngày làm cuối đã qua (thay cho job mỗi phút) — chỉ để màn hình có trạng thái "Đã nghỉ".
5. Không có "Bảng lương" (Mốc 4).

## Kết quả lệnh (worktree T-025, chỉ việc nhẹ)

- `pnpm --filter web typecheck`: exit 0 · `eslint src test app`: exit 0 · `lint:deps` FSD: no violations (577 modules)
- `vitest run --maxWorkers=2` toàn bộ web: **94 file, 663 passed + 3 todo, exit 0** (trước khi sửa 1 lỗi lint ở test admin; sau sửa chạy lại file đó 4/4).
- Hook pre-commit xanh ở mọi commit. **CHƯA chạy**: `pnpm verify`, Playwright (API T-061/T-062 chưa có).

## Còn chờ / rủi ro

- B: nguồn thành viên ws mồ côi (mục 1), xác nhận các mã ở mục 2; `MeResponse.company` + event `company:access-changed` (từ T-065a).
- B6 (Zalo giữ fragment) vẫn phải thử trên điện thoại thật trước deploy; dự phòng token-trong-path cần đổi `useActivationToken` (một chỗ).
- T-065c còn: combobox thêm thành viên workspace (`member-candidates`), bỏ công tắc HR ở Thành viên ws, xóa `/register` + link.
- Chưa xem trên trình duyệt thật.
