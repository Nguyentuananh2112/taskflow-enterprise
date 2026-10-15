# E2 — Báo cáo: kéo bằng bàn phím vào cột TRỐNG thả về cột cũ (WCAG 2.1.1)

**Người làm:** Engineer E (`taskflow-enterprise-54`) · **Branch:** `fix/dnd-keyboard-empty-column` (rebase trên main `139301b`) · **Ngày:** 2026-10-15
**Nguồn:** F (QA) tìm khi chạy E2E-03; Tech Lead xếp Medium (a11y), BACKLOG E2.

## 1. Tái hiện (Chrome thật, build prod, CSP production, API thật)
Probe CDP `Space → ArrowRight → chờ → Space` trên dự án có 2 thẻ ở "Cần làm", "Đang làm" trống; lấy mẫu mỗi frame cột nào là drop target (`ring-2`), cột nào chứa thẻ, lời thông báo a11y.

Trước khi sửa:
```
t=369  ring=Đang làm  card=Cần làm   live="… đang ở cột Cần làm."
t=380  ring=Đang làm  card=Đang làm  ← preview dời thẻ sang cột trống
t=391  ring=—         card=Cần làm   ← 11ms sau bị kéo về
t=889  "Đã thả … vào cột Cần làm."   — không có PATCH /move
```
Khớp đo đạc của F (drop target sáng ~20ms rồi null, thông báo kẹt ở "Cần làm").

## 2. Nguyên nhân gốc
`SortableTaskCard` lấy `group` (và `data.status`) của sortable từ **`task.status`**. Trong lúc kéo, board render từ `preview` (chỉ dời id) nên thẻ đã nằm trong cột "Đang làm" nhưng `task.status` vẫn là `TODO`:

- `SortableKeyboardPlugin` (@dnd-kit/dom 0.5.0) sau `setDropTarget(cột)` so `source.sortable.group` cũ/mới để biết thẻ đã sang nhóm mới; `group` vẫn `TODO` ⇒ coi như chưa đổi ⇒ bật lại collision ⇒ va chạm chọn thẻ ở cột cũ, `data.status = TODO` ⇒ `onDragOver` → `move()` dời thẻ về.
- Cột **đã có thẻ** không lộ lỗi vì `OptimisticSortingPlugin` (chỉ chạy khi đích là sortable) tự gán `sortable.group` mới; cột trống chỉ có droppable của cột ⇒ không ai gán hộ.
- Cùng nguyên nhân làm lời thông báo a11y ("đang ở cột …") đọc sai cột.

## 3. Sửa
`board-column.tsx` truyền cột đang render (`column={status}`) vào `SortableTaskCard`; thẻ dùng `group: column` và `data.status: column`. Ngoài lúc kéo `column === task.status` nên không đổi hành vi nào khác.

Đã thử thêm `flushSync` cho dragover đổi cột (để plugin đọc nhóm mới ngay) — đo lại **không cần**: chỉ sửa `group` theo cột đã đạt 4/4 kể cả chờ ~2 frame; bỏ `flushSync` để không ép render đồng bộ mỗi lần kéo chuột qua cột.

## 4. Kiểm chứng
- **Unit (hồi quy tất định):** `sortable-task-card.test.tsx` — thẻ `status: TODO` render trong cột IN_PROGRESS ⇒ sortable trong registry THẬT có `group = IN_PROGRESS`, `data.status = IN_PROGRESS`. Trên code cũ test **fail** (`expected 'TODO' to be 'IN_PROGRESS'`), sau sửa pass.
- **Chrome thật (build prod, CSP nonce, API thật):**

Lượt thăm dò khi điều tra (cùng code sửa, trước/sau khi bỏ `flushSync`): 5/5 + 4/4 đạt. **Bản build cuối** (commit của branch, sau rebase):

| Kịch bản | Kết quả |
|---|---|
| Bàn phím → cột trống, chờ 500ms | 2/2 thả vào "Đang làm", PATCH /move 200, thông báo "Đã thả … vào cột Đang làm", 0 vi phạm CSP, 0 lỗi console |
| Bàn phím → cột trống, chờ 34ms (~2 frame như E2E-03) | 2/2, như trên |
| Bàn phím → cột đã có thẻ (hồi quy) | đạt, PATCH 200, `<style>` đều có nonce |
| Kéo chuột vào cột trống (hồi quy) | đạt, PATCH 200, `<style>` đều có nonce, 0 vi phạm CSP |

Cổng chính thức: **E2E-03** của F (`e2e/specs/kanban.e2e.ts`).

## 5. Definition of Done
```
$ pnpm install --frozen-lockfile        → exit 0
$ pnpm verify                           → exit 0 (lint gồm env-example 0 · typecheck 0 · test 162 file / 1631 test 0, 0 "Unhandled" · audit --prod 0)
$ pnpm --filter @taskflow/web build     → exit 0
```
Hook pre-commit chạy đầy đủ mọi commit (không `--no-verify`).

## 6. Ghi chú
- Lượt probe gặp **429** đăng nhập theo IP (đúng thiết kế) — vòng chạy chờ `retryAfterSec`, không lách. Cookie refresh không dùng lại giữa các lượt (xoay vòng — dùng lại sẽ bị coi là reuse).
- Cổng 3001 đang do web của phiên khác (worktree T-024) giữ ⇒ probe chạy web :3002 + API :4001 riêng (CORS cho 3002), không đụng server của phiên khác.
