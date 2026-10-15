# T-003 — Báo cáo (Engineer C)

## Đã làm
- Viết `docs/design/data-and-api.md`, đủ 6 mục của ticket: data model v1.1 (schema Prisma + bảng index có lý do), REST contract, envelope + danh mục mã lỗi, WebSocket contract, thiết kế `packages/contracts`, bảng luật nghiệp vụ task. Phụ lục cuối file là các câu hỏi mở.
- Đã hợp nhất bản auth/permission/mã lỗi Engineer B chốt (T-002): `refresh_tokens.family_expires_at`, reason `USER_DELETED`, bỏ `last_used_at`, `ip @db.Inet`. Permission chi tiết (`member:add/update-role/remove`, `project:create/update/archive`, `task:assign:any/own`). Các mã `REFRESH_IN_PROGRESS`, `ORIGIN_NOT_ALLOWED`, `INVALID_CURRENT_PASSWORD`, `UNSUPPORTED_MEDIA_TYPE`, `SERVICE_UNAVAILABLE`. Thứ tự kiểm tra 401→400→404→403→422→409. Bắt buộc query có phạm vi tenant. Socket `auth:renew`, `auth:expired`, `workspace:access-revoked`, ack `{ ok, code }`.
- Không viết code, không commit.

## File
- `docs/design/data-and-api.md` (mới)
- `docs/reviews/T-003-report.md` (mới)

## Quyết định tôi tự đưa ra (đánh dấu ĐỀ XUẤT trong tài liệu)
1. Task **xóa mềm** (`deleted_at`). Audit vẫn giữ FK hợp lệ, mã TF-n không bị tái sử dụng.
2. User **không bao giờ hard-delete**; xóa tài khoản sẽ là ẩn danh hóa. `TaskAuditLog.actorId` dùng `onDelete: Restrict`.
3. Audit có `workspaceId`/`projectId` dạng cột thường, kèm `requestId`. `task_id` vẫn Cascade, nên audit chỉ mất khi xóa cả workspace.
4. `Task.workspaceId` denormalize, ràng buộc bằng FK kép `(project_id, workspace_id)`.
5. `keyPrefix` bất biến. `key` không lưu mà suy ra từ `keyPrefix` và `number`. Cấp số task bằng `UPDATE … RETURNING` trong transaction, đồng thời kiểm tra archived một cách nguyên tử.
6. Rank dùng collation "C" và unique partial `(project_id, status, rank) WHERE deleted_at IS NULL`. Nếu va chạm, server tự thử lại 3 lần, sau đó trả 409.
7. Ngữ nghĩa move `afterId`/`beforeId`: server tính rank từ dữ liệu DB, không tin rank do client gửi.
8. `VERSION_CONFLICT` trả kèm `details.current: TaskDto` để FE không phải refetch.
9. FE bỏ event của chính mình bằng `X-Client-Id` theo tab, không dùng `socket.id`. Event đến trễ được lọc bằng `version`, task đã xóa được nhớ bằng tombstone. Chỉ refetch khi reconnect.
10. `dueDate` kiểu DATE và cho phép ngày quá khứ. Description tối đa 10 000 ký tự. Lệnh không đổi gì thì không tăng version, không ghi audit.
11. Project archived thì cấm cả **xóa** task (mở rộng ADR-023).
12. Xóa thành viên thì bỏ gán mọi task của người đó, có audit và event.
13. UUID v7 cho khóa chính.
14. Ngoại lệ envelope: logout/logout-all trả 204 (theo B). Mọi DELETE khác trả 200 + `data`.

## Rủi ro
- Một số điểm cú pháp chưa kiểm chứng, đã đánh dấu `TODO(T-001)`: `uuid(7)`, collation cột và partial unique index (có thể phải viết SQL tay trong migration), Prisma 7 `update` với where không-unique, Zod 4 `z.iso.date()`.
- Xóa mềm: mọi query đọc phải lọc `deleted_at`. Cần gom vào repository/query handler và viết test.
- Rank không có rebalance ở v1.1. Rank có thể dài dần ở cột kéo thả nhiều.
- Move bởi người khác cũng tăng version, nên người đang sửa title sẽ gặp 409. FE cần UX hòa giải (đã có `details.current`).

## Câu hỏi mở cho Tech Lead
Q1 quyền sửa/gán của MEMBER · Q2 khôi phục/purge task xóa mềm · Q3 nơi đặt bảng chuyển trạng thái (domain vs contracts) · Q4 VIEWER làm assignee · Q5 cấm xóa task khi archived · Q6 `EMAIL_ALREADY_EXISTS` (từ B). Chi tiết ở phụ lục của `data-and-api.md`.

---

## T-003b — Bổ sung sau review (ADR-041 → ADR-047)

### Đã làm (chỉ trong `docs/design/data-and-api.md`)
- **ADR-044**: R6 yêu cầu assignee có role ≥ MEMBER. R14 thêm trường hợp bị hạ xuống VIEWER. Mục 1.9 mới mô tả việc bỏ gán task trong transaction, có audit và event, và chống race với assign đồng thời bằng `FOR SHARE` trên dòng membership. `PATCH members/:userId` giờ trả `{ member, unassignedTaskCount }`.
- **ADR-046**: mục 1.8 mới mô tả cách khóa các dòng OWNER bằng `SELECT … FOR UPDATE ORDER BY id`, giải thích vì sao cách này đủ ở mức READ COMMITTED, và gom thành hàm `lockOwners()` trong repository dùng `$queryRaw`.
- **ADR-047**:
  - Schema: `workspaces.deleted_at`, `purge_at`, `deleted_by_id` (FK SetNull), cùng index cho hai cột sau.
  - Mục 1.7 mới: luồng xóa, luồng khôi phục, purge job chạy theo lô và idempotent, và cách loại workspace đã xóa khỏi mọi truy cập (middleware membership, `project:join`, `GET /workspaces`, `/auth/me`).
  - REST: `DELETE` trả `DeletedWorkspaceDto`; thêm `POST /workspaces/:wsId/restore`, `GET /workspaces?deleted=true` và permission `workspace:restore`; thêm luật R18.
- Gắn nhãn ADR-041/043/045 vào R5, R7, R8 và mục contracts. Phụ lục đổi thành bảng trạng thái Q1–Q7.

### Quyết định tự đưa ra (T-003b)
1. Khôi phục workspace: **có**, do OWNER thực hiện trong 30 ngày (Q7). Membership giữ nguyên trong thời gian ân hạn nên không cần lưu riêng "OWNER lúc xóa".
2. Slug vẫn giữ chỗ trong thời gian ân hạn, nên khôi phục không bao giờ bị trùng slug.
3. Purge xóa audit/task theo lô trước, rồi mới xóa workspace, để tránh một transaction cascade khổng lồ.

### Rủi ro / phụ thuộc
- Cơ chế lịch cho purge job còn chờ T-001. Job phải an toàn khi chạy nhiều instance.
- Nếu middleware membership có cache thì phải xóa cache khi workspace bị xóa hoặc khôi phục.
- Cần Engineer B cập nhật `security.md`: permission `workspace:restore` và middleware `includeDeleted`, gửi `workspace:access-revoked` tới mọi thành viên khi xóa workspace, và thêm test cho route restore (không phải OWNER ⇒ 404).
