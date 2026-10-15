# T-003 — Data model v1.1 & API/WebSocket contract

**Giao cho:** Engineer C (`taskflow-enterprise-ba`) · **Phase:** 0 · **Loại:** tài liệu thiết kế, KHÔNG viết code ứng dụng

## Bối cảnh
Đọc `docs/TEAM.md`, `docs/blueprint/DECISIONS.md` (đặc biệt ADR-010 → ADR-023), mục 1, 3, 5, 6 của `docs/blueprint/PROJECT_BLUEPRINT_v1.0.md`. Dự án chạy production thật.

## Việc cần làm — viết `docs/design/data-and-api.md` gồm:
1. **Data model v1.1** — viết schema Prisma đầy đủ ở mức model (cú pháp generator/datasource sẽ khớp Prisma 7 sau khi T-001 xong; ghi `// TODO(T-001)` ở đó). Bắt buộc có:
   - `Task.createdById` (ADR-022), `Task.rank String` thay `positionIndex Float` (ADR-011) + index phù hợp, `Task.version`.
   - `Project.keyPrefix` unique trong workspace + bộ đếm `Project.nextTaskNumber` và `Task.number` để có mã `TF-101` (FR-03) — cấp số an toàn khi đồng thời (mô tả cách: `UPDATE ... RETURNING` trong transaction).
   - Audit log: cân nhắc `TaskAuditLog.actorId` không nên `onDelete: Cascade` (xóa user làm mất lịch sử) → đề xuất phương án. Cân nhắc audit có cần sống sót khi task bị xóa không (production thật → thường cần). Đề xuất `workspaceId`/`projectId` trên audit để truy vấn.
   - Các cột auth do Engineer B (T-002) gửi sang — hợp nhất vào.
   - Soft delete hay hard delete cho task? Đề xuất và lý do.
   - Mọi FK có index; liệt kê lý do từng index.
2. **REST API contract** theo route lồng nhau (ADR-020). Bảng: Method · Path · Permission · Request (body/query) · Response `data` · Lỗi có thể trả. Phủ đủ: auth (register/login/refresh/logout/logout-all/me), workspaces (list của tôi, get, update, delete), members (list, invite/add, đổi role, remove), projects (list, create, update, archive/unarchive), tasks (list theo project, get, create, update fields, move — đổi status và/hoặc vị trí với `expectedVersion`, assign, delete), audit log (list theo task, phân trang cursor).
3. **Envelope & mã lỗi**: giữ envelope v1.0, thêm `meta` phân trang cursor. Danh mục `error.code` đầy đủ (VALIDATION_ERROR, UNAUTHORIZED, FORBIDDEN_ACCESS, RESOURCE_NOT_FOUND, BUSINESS_RULE_VIOLATION, VERSION_CONFLICT, INVALID_STATUS_TRANSITION, PROJECT_ARCHIVED, RATE_LIMITED, ...) + HTTP status.
4. **WebSocket contract**: event client→server và server→client, payload chính xác. Payload `task:*` phải đủ để FE cập nhật cache **không cần refetch** (gửi DTO task đầy đủ + `version`). Quy ước bỏ qua event của chính mình / xử lý event đến trễ (so `version`).
5. **Thiết kế `packages/contracts`**: liệt kê các Zod schema sẽ có (tên export, file), quy ước đặt tên (`CreateTaskBody`, `TaskDto`, ...), những gì KHÔNG được để trong contracts (logic domain).
6. **Luật nghiệp vụ task** dạng bảng: state machine, archived project, assignee phải là member, title 3–150 ký tự, description tối đa?, dueDate quá khứ có cho không?, priority mặc định, ai được đổi assignee.

## Phạm vi sở hữu (chỉ được ghi)
- `docs/design/data-and-api.md`
- `docs/reviews/T-003-report.md`

## Phối hợp
- Engineer B (`taskflow-enterprise-87`) sẽ gửi danh sách cột/bảng auth và permission cho endpoint. Mã lỗi thống nhất với B.
- Quyết định lớn chưa có trong DECISIONS → hỏi Tech Lead `taskflow-enterprise-0b`.

## Hoàn thành khi
Đủ 6 mục; báo cáo xong; SendMessage `DONE T-003` cho `taskflow-enterprise-0b`.
