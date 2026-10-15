import { test } from '../support/fixtures';

// Kịch bản frontend.md §8 chưa chạy được — LUÔN hiện trong báo cáo là fixme (không xanh giả).
// Bật từng cái khi phụ thuộc merge: task API (T-023/T-024) + Kanban (T-025, đã merge).

const TASK_API = 'cần route task (T-023/T-024)';
const pending: [id: string, title: string, blockedBy: string][] = [
  ['E2E-01', 'Đăng ký → board project mặc định → tạo task → cuối cột Cần làm', TASK_API],
  ['E2E-02', 'Kéo Cần làm → Đang làm bằng chuột; reload giữ cột + thứ tự', TASK_API],
  ['E2E-03', 'Kéo bằng bàn phím (Space, mũi tên, Space)', TASK_API],
  ['E2E-04', 'Kéo Cần làm → Hoàn thành bị chặn, không có PATCH', TASK_API],
  ['E2E-05', 'Realtime 2 người < 1s; workspace khác không thấy gì', TASK_API],
  ['E2E-06', 'Xung đột 409: khối hòa giải / tự rebase', TASK_API],
  ['E2E-07', 'VIEWER: không tạo, không kéo, drawer chỉ đọc', TASK_API],
  ['E2E-08', 'Lưu trữ project khi B đang mở board ⇒ banner chỉ đọc', TASK_API],
  ['E2E-09', 'A xóa B khỏi workspace khi B mở board ⇒ về /w + toast', TASK_API],
  [
    'E2E-11',
    'Access token hết hạn ⇒ refresh trong suốt',
    'API chưa có biến env TTL access token ngắn',
  ],
  [
    'E2E-12',
    'axe: không vi phạm serious/critical (sáng/tối)',
    'devDependency @axe-core/playwright — hỏi TL',
  ],
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
