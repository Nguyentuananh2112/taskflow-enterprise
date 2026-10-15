import { test } from '../support/fixtures';

// Kịch bản frontend.md §8 chưa chạy được — LUÔN hiện trong báo cáo là fixme (không xanh giả).
// Bật từng cái khi phụ thuộc merge: task API (T-023/T-024) + Kanban (T-025, đã merge).

const TASK_API = 'kịch bản Kanban đang viết (T-024 đã merge)';
const pending: [id: string, title: string, blockedBy: string][] = [
  ['E2E-05', 'Realtime 2 người < 1s; workspace khác không thấy gì', TASK_API],
  ['E2E-06', 'Xung đột 409: khối hòa giải / tự rebase', TASK_API],
  ['E2E-07', 'VIEWER: không tạo, không kéo, drawer chỉ đọc', TASK_API],
  ['E2E-08', 'Lưu trữ project khi B đang mở board ⇒ banner chỉ đọc', TASK_API],
  ['E2E-09', 'A xóa B khỏi workspace khi B mở board ⇒ về /w + toast', TASK_API],
  ['E2E-12b', 'axe trên board, drawer, trang thành viên (sáng/tối)', TASK_API],
  ['E2E-13', 'Offline rồi online ⇒ board tự refetch', TASK_API],
  ['E2E-14', 'Xóa workspace khi B mở board; khôi phục ⇒ B vào lại', TASK_API],
  ['E2E-15', 'Hạ B xuống VIEWER ⇒ mất kéo, 2 task "Chưa giao"', TASK_API],
  [
    'E2E-16',
    'Cùng image web, API_URL khác ⇒ request đúng host',
    'chạy trong CI (2 lần khởi động container)',
  ],
];

for (const [id, title, blockedBy] of pending) {
  test.fixme(`[PENDING ${blockedBy}] ${id} — ${title}`, () => undefined);
}
