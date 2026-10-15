# T-007 — Báo cáo (Engineer C)

## Đã làm
- Viết `docs/design/test-spec-task.md`: đặc tả TDD dạng Given/When/Then cho Task domain, khoảng 190 case.
  - Mỗi case ghi một tầng test: U (unit domain), A (unit application với repo InMemory), I (integration Postgres), C (concurrency).
  - Phủ `TaskEntity`: create, đủ 16 cặp trạng thái, move rank, assignTo, update, softDelete, version, no-op, domain events.
  - Phủ `TaskPolicy` dạng bảng theo ADR-022/041.
  - Phủ 7 use case/query: Create (gồm cấp TF-n đồng thời), Move, Assign, Update, Delete, ListByProject, AuditLog list.
  - Thêm phần bỏ gán khi mất quyền nhận việc (ADR-044), ánh xạ domain event → realtime, và ma trận truy vết luật R1–R16/ADR → test.
- Áp dụng phản hồi review T-003b vào `docs/design/data-and-api.md`:
  - ADR-050: restore chuyển sang ✅.
  - ADR-051: thêm index `(workspace_id, role)` vào schema và bảng index.
  - ADR-049: mật khẩu tối thiểu 12 ký tự. Thêm định nghĩa `Password` của contracts vào mục 5.2; việc chặn mật khẩu phổ biến nằm ở application, không nằm trong contracts.
- Không viết code, không commit.

## File
- `docs/design/test-spec-task.md` (mới)
- `docs/reviews/T-007-report.md` (mới)
- `docs/design/data-and-api.md` (theo yêu cầu trong review T-003b)

## Quyết định tự đưa ra (cần duyệt)
1. **Kiểm `expectedVersion` trước khi phát hiện no-op.** Lệnh không đổi gì nhưng version cũ vẫn trả 409 (mục 0.4; UC-MV16). Lý do: client đang giữ dữ liệu cũ luôn nhận được bản mới nhất, và luồng xử lý chỉ có một đường.
2. **Domain không gọi `fractional-indexing`.** Rank là value object; application tính rank qua port `IRankGenerator`, nên domain test được với chuỗi giả.
3. **Bỏ gán hệ thống không bị chặn bởi project archived.** Hạ role hoặc xóa thành viên vẫn bỏ gán task của họ trong project đã archive (UC-UN01). Nếu không làm vậy, VIEWER vẫn bị gán task ở project archived, vi phạm ADR-044. Đây là ngoại lệ của R5/ADR-045 — **Q2 cho Tech Lead**.
4. **Gán cho uuid không tồn tại trả 422 `ASSIGNEE_NOT_MEMBER`, không trả 404**, để không lộ user nào tồn tại (UC-AS06). Anchor ở project khác hoặc không tồn tại trả `INVALID_ANCHOR` vì cùng lý do.
5. **`TaskEntity.create` có assignee chỉ phát `TaskCreated`**, không phát thêm `TaskAssigneeChanged`.
6. **Đề xuất Task module cung cấp `UnassignTasksOfUser`** cho module Workspace gọi trong transaction đổi role/xóa thành viên.
7. **Test concurrency** chạy 1 lượt ở PR và 20 lượt ở nightly. Test `EXPLAIN` chỉ chạy nightly.

## Rủi ro
- Test concurrency phụ thuộc pool kết nối ≥ N và Postgres trong Docker trên CI. Có thể chậm hoặc chập chờn, cần theo dõi khi Phase 1 dựng CI.
- UC-LS05 (phân trang khi dữ liệu đang đổi) chỉ ghi lại hành vi chấp nhận được, không đảm bảo snapshot.
- Phần API entity ở mục 0.3 là hợp đồng giả định. Nếu đổi tên khi hiện thực thì phải sửa test tương ứng.

## Câu hỏi mở cho Tech Lead
- **Q1**: Chấp nhận quyết định 1 (version trước no-op)?
- **Q2**: Chấp nhận quyết định 3 (bỏ gán hệ thống vượt qua project archived)?
- **Q3**: Có cần đưa `UnassignTasksOfUser` vào ranh giới module trong `dependency-cruiser` (Workspace → Task qua interface application) không?
