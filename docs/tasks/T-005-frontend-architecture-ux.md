# T-005 — Kiến trúc Frontend & đặc tả UX

**Giao cho:** Engineer E (`taskflow-enterprise-b7`) — Frontend · **Phase:** 0 · **Loại:** tài liệu thiết kế, KHÔNG viết code ứng dụng

## Bối cảnh
Đọc `docs/TEAM.md`, `docs/blueprint/DECISIONS.md` (ADR-001, 004, 010, 011, 026, 027), mục 2.1 và 4 (phần frontend) + 7 (cuối) của `docs/blueprint/PROJECT_BLUEPRINT_v1.0.md`. Stack: Next.js 16 App Router, React, Tailwind, Feature-Sliced Design. Quy tắc cứng: component ≤ 150 dòng; cấm axios/fetch trong `.tsx`; ≤ 3 `useState` mỗi presentational component. Access token chỉ ở bộ nhớ, dashboard render client-side (ADR-026). Giao diện tiếng Việt.

## Việc cần làm — viết `docs/design/frontend.md` gồm:
1. **Sitemap & màn hình**: danh sách route Next (landing, login, register, chọn workspace, danh sách project, board Kanban, chi tiết task (drawer/modal?), cài đặt workspace & thành viên, cài đặt project, hồ sơ/đăng xuất mọi thiết bị). Mỗi màn: mục đích, quyền cần (theo role), trạng thái loading/empty/error. Wireframe ASCII cho 3 màn chính (board, chi tiết task, thành viên).
2. **Cấu trúc FSD cụ thể**: `app/` · `widgets/` · `features/` · `entities/` · `shared/` — liệt kê từng slice sẽ có, public API (`index.ts`), quy tắc import giữa các layer (sẽ ép bằng ESLint/dependency-cruiser — ghi rule cụ thể).
3. **Quản lý state & dữ liệu**: TanStack Query (query keys, staleTime), auth store (token trong bộ nhớ, bootstrap bằng `/auth/refresh`, hàng đợi request khi đang refresh, xử lý refresh thất bại), không dùng Redux trừ khi có lý do.
4. **Kanban & đồng bộ realtime** — phần quan trọng nhất:
   - Kéo thả bằng dnd-kit: trong cột và giữa cột, bàn phím (accessibility), cột không cho thả (state machine — vd TODO→DONE phải bị chặn/ báo trước khi gửi).
   - Optimistic update → server trả 409 `VERSION_CONFLICT` hoặc 422 → rollback + toast; gửi `expectedVersion`.
   - Socket event `task:*` merge vào Query cache: bỏ qua event cũ (so `version`), event của chính mình, reconnect thì refetch.
   - Rank: client gửi `beforeId/afterId` hay rank — thống nhất với Engineer C (T-003).
   - Hiệu năng: board 500 task vẫn mượt (memo, ảo hóa cột nếu cần).
5. **Ẩn/hiện theo quyền**: hook `usePermission()` dựa trên role trong workspace hiện tại; UI chỉ là tiện ích, server mới là nguồn chặn thật.
6. **Design system tối thiểu**: token màu (sáng/tối), typography, khoảng cách; danh sách component `shared/ui` (Button, Input, Select, Badge, Avatar, Dialog, Drawer, Toast, Skeleton, EmptyState...). Đề xuất có dùng thư viện headless (Radix/shadcn) hay không, lý do.
7. **Form & validation**: dùng chung Zod schema từ `packages/contracts`; thư viện form (react-hook-form?) — lý do; hiển thị lỗi server `details` theo field.
8. **Kế hoạch test FE**: unit (hooks, reducer merge socket), component test, Playwright E2E cho luồng chính (đăng ký → tạo task → kéo → người thứ 2 thấy realtime).
9. **Ước lượng & chia việc Phase 4**: chia frontend thành các gói việc có thể làm song song bởi 2 người không đụng file nhau.

## Phạm vi sở hữu (chỉ được ghi)
- `docs/design/frontend.md`
- `docs/reviews/T-005-report.md`

## Phối hợp
- API/WebSocket contract: Engineer C (`taskflow-enterprise-ba`, T-003) — hỏi trực tiếp về payload, cách gửi vị trí kéo thả.
- Auth flow phía client: Engineer B (`taskflow-enterprise-87`, T-002).
- Phiên bản Next 16 / Tailwind / dnd-kit / TanStack Query: Engineer A (`taskflow-enterprise-50`, T-001) → `docs/research/stack-versions.md`. Đừng đoán API của bản mới — kiểm chứng.
- Quyết định lớn → Tech Lead `taskflow-enterprise-0b`.

## Hoàn thành khi
Đủ 9 mục; báo cáo xong; SendMessage `DONE T-005` cho `taskflow-enterprise-0b`.
