# fix/G1-workspace-fe — sửa W1–W4, I1, I2 của G1 workspace API ↔ web

Engineer E · 2026-10-16 · từ main `25ba093` · findings gốc: `docs/reviews/G1-workspace-fe.md`. I3 do Tech Lead chốt (ADR-117, last-write-wins cho PATCH workspace/project — Tech Lead ghi ADR).

## Đã sửa
| # | Sửa | File |
|---|---|---|
| W1 | `isWorkspaceGone` (404 + `details.resource = 'workspace'`) + `forgetWorkspace` (dọn cache ws, làm mới list/me) trong `entities/workspace`; xóa thành viên / đổi vai trò gặp 404 `workspace` ⇒ toast "Bạn không còn truy cập được workspace này" + về `/w` (như `workspace:access-revoked`). `use-realtime-session` và tự rời dùng chung helper. | `entities/workspace/model/workspace-gone.ts`, `entities/session/@x/workspace.ts` (+`sessionKeys`), `features/member-remove`, `features/member-change-role` (prop `onLeft` mới), `widgets/member-table/ui/member-row.tsx`, `features/realtime-session` |
| W2 | Xóa thành viên lỗi (khác 404 `workspace`) ⇒ invalidate bảng thành viên | `features/member-remove/ui/remove-member-button.tsx` |
| W3 | PATCH workspace gặp `VERSION_CONFLICT`/404 ⇒ invalidate detail; PATCH project gặp `PROJECT_ARCHIVED`/`VERSION_CONFLICT`/404 ⇒ invalidate detail (nút Lưu trữ ⇄ Khôi phục đúng); lưu trữ/khôi phục lỗi ⇒ invalidate detail | `features/workspace-edit/model/use-update-workspace.ts`, `features/project-edit/ui/project-general-form.tsx`, `features/project-archive/ui/archive-project-button.tsx` |
| W4 | Board bỏ `project:updated` có `updatedAt` CŨ HƠN bản đang có; bằng nhau ⇒ nhận (ý kiến B: 2 lần ghi cùng ms) | `features/board-realtime/model/project-event-order.ts` (+ test), `use-board-realtime.ts` |
| I1 | `frontend.md` §3.5: đường dự phòng 404 `workspace`/`user`; những gì KHÔNG live (bảng thành viên admin khác, danh sách/cài đặt dự án) + quy tắc thứ tự `project:updated` + ADR-117 | `docs/design/frontend.md` |
| I2 | Mock `already_member` bỏ `field: 'email'` cho khớp API thật | `app/mock-api/member-handlers.ts` |

## Test mới
- `apps/web/test/admin-g1.test.tsx` (5 ca, mock API + socket giả, thay đổi ghi thẳng vào mock db = không có event, như socket rớt): W1 xóa / W1 đổi vai trò ⇒ `/w` + đúng câu, không câu sai; W2 hàng biến mất + câu đúng; W3 dự án lưu trữ ở nơi khác ⇒ nút thành "Khôi phục dự án"; W3 workspace bị xóa ⇒ màn Không tìm thấy.
- `project-event-order.test.ts` (3 ca: chưa cache, cũ/mới, cùng ms).

## Kết quả lệnh
Xem cuối file.
