# E5 — Khung layout chung (board 1440px) + đóng G2 F2–F4

Engineer E · 2026-10-16 · branch `feat/E-layout-g2` (từ main `d647383`)

## (1) Board 1440px lệch cột dọc

**Nguyên nhân:** `AppHeader` dùng `mx-auto max-w-5xl px-4` (căn giữa, 1024px), board dùng `<main className="px-4 …">` không giới hạn ⇒ ở 1440px logo "TaskFlow" ở x=224, tiêu đề + cột đầu board ở x=16 (lệch 208px). Các màn khác cũng mỗi màn một `max-w-*` căn giữa riêng (2xl/3xl/4xl/5xl/md) ⇒ mép trái nhảy theo màn.

**Sửa:**
- `shared/ui/page` mới: `PAGE_CONTAINER = 'mx-auto w-full max-w-7xl px-4 sm:px-6'` + `PageMain` (`<main>` trong khung; `className` áp lên khối nội dung bên trong, căn trái).
- `AppHeader` và 8 màn khu đã đăng nhập (board, workspace picker, tạo workspace, danh sách dự án, cài đặt dự án, cài đặt workspace, thành viên, tài khoản) dùng chung khung. Màn form giữ giới hạn bề ngang cũ (`max-w-md/2xl/3xl`) nhưng căn trái trong khung; màn danh sách dùng hết khung.
- Board: vùng cuộn ngang tràn ra lề khung (`-mx-4 px-4 sm:-mx-6 sm:px-6`) — cột cuộn tới sát mép màn trên mobile, mép trái lúc chưa cuộn vẫn thẳng header.
- Giữ nguyên (ngoại lệ có chủ đích): màn khách (`AuthCard`, landing), khối lỗi/404 toàn màn `max-w-md` căn giữa.
- `frontend.md` §6.2 ghi luật khung ngang.

**Đo (Playwright headless, mock API, đo `getBoundingClientRect().left`; script tạm ở scratchpad, không commit):**

| | logo / h1 / cột đầu (px) | trang tràn ngang | board cuộn ngang trong khung |
|---|---|---|---|
| Trước — 1440 sáng/tối | 224 / 16 / 16 | 0 | — |
| Sau — 360 sáng/tối | 16 / 16 / 16 | 0 | có (4 cột) |
| Sau — 768 sáng/tối | 24 / 24 / 24 | 0 | có |
| Sau — 1440 sáng/tối | 104 / 104 / 104 | 0 | không cần |

7 màn còn lại (`/w`, projects, settings, members, project settings, account, `/w/new`) ở 360 và 1440: logo = h1 (16 và 104), không tràn ngang. Đo lại trên **build prod** (`next build` + `next start`): cùng số. Ô xám góc trái-trên thấy trên ảnh dev là chỉ báo dev của Next — không có ở prod.

## (2) G2 frontend F1–F4

- F1 — đã sửa code trên main trước đó (đếm ngược + khóa nút, `login-form.test.tsx`). Không đổi.
- F2 — `frontend.md` §6.3: thay danh sách bằng bảng component **có thật** + bảng "không có — dùng thay" (ConfirmDialog → `Dialog`+footer, ErrorState → `EmptyState`+Thử lại, Banner → `Alert`/khối viền trái, DatePicker → `input type=date`, Tabs → link `aria-current`, Field/Checkbox/IconButton/Tooltip/Popover chưa cần).
- F3 — §1.2 Cài đặt workspace: câu dialog đúng chữ trong `delete-workspace-section.tsx`; cột Error thêm 404 (toast + `/w`) và 400/409 (refetch, xóa ô nhập, thông báo).
- F4 — §0: nêu cả 2 biến thể cookie (`__Host-tf_rt; Path=/` staging/prod, `tf_rt; Path=/api/v1/auth` dev), dẫn ADR-109; kết luận "không redirect auth phía server" giữ nguyên.
- `G2-design-drift.md`: ghi trạng thái đã đóng F1–F4.

## File
`apps/web/src/shared/ui/page/{index.ts,page-main.tsx,page-main.test.tsx}` (mới) · `widgets/app-header/ui/app-header.tsx` · `widgets/kanban-board/ui/kanban-board.tsx` · `views/{account,board,members,project-list,project-settings,workspace-new,workspace-picker,workspace-settings}/ui/*-page.tsx` · `docs/design/frontend.md` · `docs/reviews/G2-design-drift.md` · `docs/tasks/BACKLOG.md` (dòng E5).

## Quyết định tự đưa ra
- Khung `max-w-7xl` (1280): đủ cho 4 cột × 288px + gap (1188px) không cuộn ở ≥1280; màn form căn trái thay vì căn giữa để giữ một mép dọc.
- Không thêm E2E layout: kiểm bằng script đo một lần. Nếu F muốn chặn hồi quy, gợi ý 1 assert `logo.left === h1.left` ở 360/1440 trong bộ viewport của F2.

## Kết quả lệnh
Trên `741dee1` (đã rebase lên main `6900a97`, `pnpm install --frozen-lockfile`):
- `VITEST_MAX_WORKERS=2 pnpm verify` ⇒ **exit 0** (lint + typecheck + test + audit; vitest báo 173 file / 1709 test passed; `No known vulnerabilities found`). Không đặt `REQUIRE_INTEGRATION`/Valkey — thay đổi chỉ ở web, test Valkey/DB của api để cổng F/Tech Lead.
- Riêng web trước rebase: `vitest run` 450/450, exit 0; `tsc --noEmit` exit 0.
- `pnpm --filter web build` (next build prod) ⇒ **exit 0** (lượt máy Tech Lead cho phép); `next start` + đo lại như bảng trên.
- Hook pre-commit (prettier, gitleaks, eslint) chạy đủ, không bỏ qua.
- Đã tắt next dev / next start :3021 sau khi đo.

## Rủi ro / câu hỏi mở
- Màn danh sách (workspace, dự án, thành viên) giờ rộng tới 1232px ở 1440 thay vì 896–1024px — lưới thẻ vẫn 2 cột (`sm:grid-cols-2`), thẻ rộng hơn. Nếu Tech Lead muốn hẹp hơn: thêm `max-w-5xl` vào `className` của `PageMain` (vẫn căn trái).
