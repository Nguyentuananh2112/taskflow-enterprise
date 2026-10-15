# T-034 — Báo cáo: màn hình quản trị workspace, thành viên, project

**Người làm:** Engineer E (`taskflow-enterprise-54`) · **Branch:** `feat/T-034` (rebase lên main `f40e0aa` — đã chứa `fix/dnd-csp-nonce`) · **Ngày:** 2026-10-15
Giữa chừng tạm dừng 2 lần cho việc gấp: `fix/web-test-timeouts` và `fix/dnd-csp-nonce` (cả hai đã merge). Mục 6: xử lý review bảo mật của B.

## 1. Đã làm
| Màn / việc | Nội dung |
|---|---|
| `/w/[wsId]/settings` | Tên + slug (OWNER sửa, role khác chỉ đọc). R19: FE **không** tự lowercase — chữ hoa bị schema contracts chặn; trùng / dành riêng ⇒ một câu chung tại ô slug. Vùng nguy hiểm (OWNER): dialog nói rõ "ẩn với mọi thành viên, xóa vĩnh viễn sau 30 ngày, Chủ sở hữu khôi phục được"; nút Xóa chỉ bật khi gõ **đúng y** slug (không trim/lowercase); xong ⇒ về `/w`. |
| `/w` | Nút "Tạo workspace" + khu "Đã xóa — khôi phục được (n)" (chỉ có dữ liệu khi là OWNER; rỗng ⇒ ẩn), "Xóa vĩnh viễn sau N ngày", Khôi phục (404 ⇒ "Không thể khôi phục workspace này"; refetch sau khôi phục — server không phát event). |
| `/w/new` | Tạo workspace (slug tùy chọn — trống ⇒ server sinh từ tên tiếng Việt) ⇒ vào danh sách dự án. |
| `/w/[wsId]/settings/members` | Bảng thành viên: tìm `q` phía server (debounce 300ms), phân trang cursor "Tải thêm". Thêm theo email (PM+; PM chỉ thấy Thành viên/Người xem). 404 (email chưa có tài khoản) và 409 (đã là thành viên) **cùng một câu chung** (security.md §6.5). Đổi role (OWNER): hạ xuống Người xem ⇒ xác nhận trước, toast "N task được bỏ giao" (ADR-044). Xóa / tự rời có xác nhận; PM chỉ thấy nút xóa ở MEMBER/VIEWER; LAST_OWNER ⇒ "Workspace phải còn ít nhất một Chủ sở hữu". Tự rời ⇒ về `/w`, xóa cache workspace, đúng một thông báo (realtime-session bỏ toast khi event do chính tab gây ra). |
| `/w/[wsId]/p/[projectId]/settings` | Tên/mô tả (PM+), mã dự án chỉ hiển thị (bất biến); lưu trữ (xác nhận, giải thích board chỉ đọc) / khôi phục; project lưu trữ ⇒ form chỉ đọc + banner; MEMBER/VIEWER chỉ xem. Lối vào: link "Cài đặt dự án" trên toolbar board. |
| Tạo dự án | Nút "Tạo dự án" (PM+) ở danh sách dự án ⇒ dialog; keyPrefix trùng ⇒ lỗi tại ô "Mã dự án"; xong ⇒ vào board. Danh sách dự án có lối vào Thành viên / Cài đặt. |
| Combobox người phụ trách | `shared/ui/combobox` theo mẫu ARIA APG (combobox + listbox, `aria-activedescendant`, ↑/↓/Enter/Esc); `AssigneePicker` tìm `q` phía server (debounce 300ms), chỉ role ≥ MEMBER; thay `<select>` 100 người của T-025 (backlog #8). |
| Realtime | `member:role-changed` ⇒ quyền đổi ngay (form/nút ẩn, dialog quản trị tự đóng vì component bị gỡ) + làm mới bảng thành viên; `workspace:access-revoked` ⇒ xóa cache ws, về `/w` + toast, không join lại phòng. |
| Lỗi | `applyServerErrors` **không còn hiển thị nguyên văn `message` của server** — câu FE theo `code` (review B); `RESOURCE_CONFLICT` có `details.field` ⇒ lỗi tại đúng ô (frontend.md §7.3). |

**Mock MSW khắt khe như server (bài học H2):** sổ workspace/thành viên riêng (`mock-workspaces.ts` — đổi tên/slug/xóa mềm thấy ở mọi thành viên); route workspace (list/`?deleted=true` lọc `purgeAt > now`, sắp `deletedAt` giảm dần; tạo; sửa; xóa mềm với `confirmSlug`; khôi phục 404 một kiểu), thành viên (add: 403 cấp role → 404 user → 409; đổi role / xóa / tự rời với LAST_OWNER, bỏ gán task kèm `task:updated` có `originClientId: null` như server), project (tạo với keyPrefix unique, sửa 422 khi lưu trữ, archive/unarchive idempotent + `project:updated` — server đã phát từ `ee4acc8`). Rate limit: add-member 30/giờ, create-workspace 10/giờ, restore 10/giờ (sau 403, trước body). Body DELETE chỉ parse khi Content-Type JSON; charset trùng lặp ⇒ 415. Socket giả: client có `userId` tự vào phòng `user:{id}`; `project:join` kiểm membership + project ∈ ws; `access-revoked` ⇒ rút khỏi phòng project của ws (như gateway).

## 2. Kiểm chứng
- **Unit/mock:** `admin-api.test.ts` (12 — thứ tự lỗi, R19, xóa/khôi phục/ân hạn, PM cấp role, 404/409, 429, ADR-044 + originClientId null, LAST_OWNER, keyPrefix, PROJECT_ARCHIVED, L4/L5), `form-errors` (+3), Combobox (3, gồm axe).
- **Component trên cây app thật** (`test/admin-screens.test.tsx`, 11 ca, axe ở từng màn): đổi tên/slug chữ hoa/slug dành riêng; xóa phải gõ đúng slug ⇒ `/w` ⇒ khu Đã xóa ⇒ khôi phục; MEMBER chỉ đọc; thêm thành viên + câu chung 404/409; PM chỉ 2 role, không đổi role, không xóa OWNER; hạ Người xem ⇒ "2 task được bỏ giao"; LAST_OWNER; tự rời 1 thông báo; realtime hạ role ⇒ form thêm biến mất, bị xóa ⇒ `/w` + toast; tạo dự án (keyPrefix trùng ⇒ lỗi field) ⇒ board; cài đặt dự án sửa/lưu trữ/khôi phục, MEMBER chỉ đọc; tạo workspace ⇒ "Dự án đầu tiên".
- Drawer: test picker cũ chuyển sang Combobox (tìm "khang" (VIEWER) ⇒ 0 kết quả, "hoa" ⇒ Mai Hoa, chọn bằng Enter).

### Lượt chạy với API thật (main có T-024/T-027/`project:updated`)
**Môi trường:** API `tsx src/main.ts` :4000 nối DB riêng `taskflow_t025` (postgres-test :5434, `db:deploy` gồm `grant-app.sql` của T-027) bằng **user `taskflow_app`** (chỉ DML — đúng mô hình production), Valkey :6380 db 9, `CORS_ORIGINS=http://localhost:3001`; web build prod `next start` :3001 trỏ API thật, không mock.
- **Luồng chức năng** `real-api/admin.real.tsx` (bộ riêng `pnpm --filter @taskflow/web test:real-api`, không vào CI): trên cây app thật — email lạ ⇒ câu chung; thêm `real2` (MEMBER); giao 1 task cho real2 rồi hạ Người xem qua UI ⇒ server bỏ giao (GET lại: `assignee: null`), UI báo "1 task được bỏ giao"; OWNER cuối tự hạ ⇒ LAST_OWNER; xóa thành viên; cài đặt dự án lưu trữ ⇒ chỉ đọc ⇒ khôi phục; đổi tên workspace (GET lại khớp). Chạy 3 lần: pass cả 3 (lần đầu bị API **rate-limit đăng ký 429** — đúng thiết kế, chờ hết cửa sổ rồi chạy). Bộ `board-two-tabs.real.tsx` (T-025) chạy kèm: pass.
- **Lighthouse 13.5.0 (desktop, Chrome thật, cookie refresh thật):**

| Trang | Accessibility | Best practices |
|---|---|---|
| `/w/[wsId]/settings` | **100** | 100 |
| `/w/[wsId]/settings/members` | **100** | 100 |
| `/w/[wsId]/p/[projectId]/settings` | **100** | 100 |
| `/w/new` | **100** | 100 |

Ảnh chụp Lighthouse cho thấy dữ liệu thật (tên workspace vừa đổi). Sau khi xem ảnh: nhãn "Vai trò của …" lặp ở từng dòng bảng ⇒ thêm `hideLabel` cho `Select` (nhãn `sr-only`, vẫn là tên truy cập; có test axe).

## 3. Quyết định tự đưa ra (cần Tech Lead duyệt)
1. Khu "Đã xóa — khôi phục được" đặt ở `/w` (frontend.md §1.1), không ở `/w/[wsId]/settings` (workspace đã xóa thì route settings của nó 404).
2. Bảng thành viên dùng `<select>` gốc cho ô vai trò (a11y + bàn phím do trình duyệt lo); Combobox chỉ cho người phụ trách (cần tìm kiếm).
3. 404/409 khi thêm thành viên dùng chung một câu (theo B); không dùng câu riêng "đã là thành viên".
4. `ClientForm` (T-029) dùng cho mọi form mới.
5. Xóa workspace: so khớp slug **phía FE y như server** (không trim) — nút chỉ bật khi khớp; server vẫn là chốt (400 nếu lệch).

## 4. Rủi ro / ngoài phạm vi
- `packages/contracts` `HealthzResponse` đã bỏ `gitSha` ở `7b84bcd` (A) — khớp web/API.
- Contracts chưa có `version` cho workspace/project (ADR-110 hiện chỉ ở server): khi C thêm `expectedVersion` vào body sửa workspace/project, form cần gửi version + xử lý 409.
- Lỗi dnd-kit CSP (`f2b735c`) đã merge (`f40e0aa`); rebase không xung đột.
- Bug mới (F tìm, có từ trước, ngoài T-034): kéo bằng bàn phím vào cột TRỐNG ⇒ thả về cột cũ — sửa ở branch riêng từ main sau T-034.

## 5. Definition of Done (worktree `D:/TaskFlow_wt/T-025`, rebase lên main `f40e0aa`, sau mục 6)
```
$ pnpm typecheck              → exit 0
$ pnpm lint                   → exit 0 (prettier; eslint --max-warnings=0; depcruise web 349 modules 0 vi phạm, api 0)
$ pnpm test --maxWorkers=2    → Test Files 156 passed (156) · Tests 1594 passed (1594) · exit 0, 0 "Unhandled"
$ pnpm --filter @taskflow/web build → exit 0
$ REAL_API_PASSWORD=… pnpm --filter @taskflow/web test:real-api (API thật) → Test Files 3 passed (3) · exit 0
$ (không đặt REAL_API_PASSWORD)  → Tests 3 skipped (3)
```
Hook pre-commit (gitleaks + prettier + eslint) chạy đầy đủ mọi commit, không `--no-verify`.

## 6. Review bảo mật của B (@ `4017bc1`) — đã xử lý
| # | Mức | Đã làm |
|---|---|---|
| F5 | Medium | `real-api/admin-refusals.real.tsx` — với API THẬT, trên workspace tạo riêng cho mỗi lượt: PM cấp OWNER (email có thật và email lạ) / cấp PM ⇒ **403 FORBIDDEN_ACCESS** (403 trước 404); đã là thành viên ⇒ **409**, UI hiện cùng câu "Không thể thêm người này"; `confirmSlug` khác hoa thường / có khoảng trắng đầu hoặc cuối ⇒ **400 VALIDATION_ERROR**; khôi phục bằng PM (vẫn là thành viên) và bằng cựu thành viên ⇒ **404, `error` giống hệt id lạ**, OWNER khôi phục được (chứng minh 404 là do quyền); bị xóa khỏi workspace khi đang mở board với **Socket.io thật** ⇒ `workspace:access-revoked` ⇒ về `/w` + toast, `project:join` lại ⇒ **RESOURCE_NOT_FOUND**. Cuối lượt workspace bị xóa mềm. |
| F2 | Low | `form-errors.ts`: VALIDATION_ERROR không còn hiển thị `issue.message` — câu FE theo `issue.code` (`common_password`, `contains_email`, `same_as_current`, `mismatch`, `invalid_format`, `too_small`, `too_big`, `unrecognized_keys`), code lạ ⇒ "Giá trị không hợp lệ."; lỗi gốc khử trùng lặp. Mock `ruleViolation` dùng đúng mã issue của server (trước là `custom`). Có test chứng minh chuỗi server không lọt vào UI. |
| F1 | Low | Khôi phục: chỉ 404 ⇒ "Không thể khôi phục workspace này"; lỗi khác (429, mạng) ⇒ `serverErrorMessage` (mới, export từ `form-errors.ts`). Test: hết hạn mức 10/giờ ⇒ "Bạn thao tác quá nhanh…". |
| F3 | Low | Dialog xóa: 404 (đã bị xóa ở tab khác) ⇒ dọn cache, về `/w`, "Workspace không còn tồn tại"; 400/409 ⇒ refetch workspace (nhãn hiện slug mới), xóa ô nhập, báo "Slug vừa thay đổi hoặc không khớp"; câu hậu quả: "biến mất ngay với mọi thành viên … chỉ Chủ sở hữu khôi phục được". 2 test. |
| F4 | Low | Tự rời ⇒ toast kèm "N task được bỏ giao". Test. |
| F6 | Info | `FakeRealtimeHub.canJoin`: có sổ thành viên mà client không có `userId` ⇒ từ chối. Test board: bị xóa ⇒ rút khỏi phòng project, join lại ⇒ RESOURCE_NOT_FOUND. |
| F7 | Info | Mật khẩu bộ real-api chỉ đọc từ `REAL_API_PASSWORD` (không còn giá trị mặc định trong repo); không đặt ⇒ skip. `loginOrRegister` chỉ đăng ký khi login 401 — 429 ném thẳng (trước đây bị che thành lỗi đăng ký). Lưu ý: commit cũ `4017bc1` (chưa merge) có giá trị mặc định cho tài khoản dev local — không phải secret, DB local. |
| F8 | Info | OWNER tự đổi vai trò của chính mình ⇒ dialog xác nhận ("mất quyền Chủ sở hữu ngay và không tự lấy lại được"). Test mock + API thật cập nhật. |
| F9 | Info | `member:role-changed` ⇒ invalidate cả `workspaceKeys.list`. |

Ghi chú lượt chạy API thật: hai lần gặp **429** (đăng ký theo IP, rồi đăng nhập theo IP) — đúng thiết kế; bộ F5 dùng 2 tài khoản sẵn có thay vì đăng ký thêm, và chờ hết cửa sổ đăng nhập, không lách.
