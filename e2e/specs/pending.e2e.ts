import { test } from '../support/fixtures';

// Kịch bản frontend.md §8 chưa chạy được — LUÔN hiện trong báo cáo là fixme (không xanh giả).
// Bật từng cái khi phụ thuộc merge: task API (T-023/T-024) + Kanban (T-025, đã merge).

const TASK_API = 'kịch bản Kanban đang viết (T-024 đã merge)';
const pending: [id: string, title: string, blockedBy: string][] = [
  [
    'E2E-REBAL',
    'Kéo nhiều lần vào giữa 2 thẻ ⇒ thứ tự đúng sau rebalance (T-033)',
    'fix dnd-kit/CSP của E',
  ],
  ['E2E-12b', 'axe trên board, drawer, trang thành viên (sáng/tối)', TASK_API],
  [
    'E2E-16',
    'Cùng image web, API_URL khác ⇒ request đúng host',
    'chạy trong CI (2 lần khởi động container)',
  ],
];

for (const [id, title, blockedBy] of pending) {
  test.fixme(`[PENDING ${blockedBy}] ${id} — ${title}`, () => undefined);
}
