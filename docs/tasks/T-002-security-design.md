# T-002 — Thiết kế bảo mật: Auth, phân quyền, đa tenant

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 0 · **Loại:** tài liệu thiết kế, KHÔNG viết code ứng dụng

## Bối cảnh
Đọc `docs/TEAM.md`, `docs/blueprint/DECISIONS.md` (đặc biệt ADR-020 → ADR-029), và mục 1.2, 6 của `docs/blueprint/PROJECT_BLUEPRINT_v1.0.md`. Dự án chạy production thật.

## Việc cần làm — viết `docs/design/security.md` gồm:
1. **Luồng xác thực** (sequence dạng mermaid hoặc liệt kê bước) cho: register (transaction: User + Workspace mặc định + OWNER membership + Project mặc định; xử lý trùng slug), login, refresh rotation (familyId, replacedById, phát hiện reuse → thu hồi family), logout (1 thiết bị), logout-all (`token_version`), đổi mật khẩu (phải thu hồi gì).
2. **Đặc tả token**: claims của access JWT (`sub`, `tv`, `iat`, `exp`, ... — KHÔNG nhét role vào JWT vì role theo workspace và có thể đổi), thuật toán ký, thời hạn, độ dài/entropy refresh token, cách hash, thuộc tính cookie, lưu trên Redis key gì + TTL.
3. **Mô hình phân quyền**: bảng permission chi tiết từ ma trận RBAC (mục 1.2 v1.0) → danh sách permission dạng `task:delete:any`, `task:delete:own`, ... gán cho từng role. Thiết kế `rbac` middleware (chặn sớm theo role tối thiểu) + Policy object ở application layer (ADR-021, ADR-022). Nêu rõ endpoint nào cần permission nào.
4. **Chống IDOR** (ADR-020): cách resolve tenant cho mọi route lồng nhau; quy tắc trả 404 vs 403; ví dụ cụ thể.
5. **Socket.io** (ADR-027): xác thực handshake, kiểm tra membership khi `project:join`, xử lý token hết hạn khi socket đang mở, xử lý khi thành viên bị xóa khỏi workspace.
6. **Hardening** (ADR-028/029): helmet config, CORS, rate-limit (con số cụ thể theo endpoint), giới hạn body, chính sách mật khẩu, chống user enumeration ở login/register, timing-safe compare, cấu hình cookie dev vs prod (localhost không có HTTPS).
7. **Danh sách test bảo mật bắt buộc** (sẽ thành test case ở Phase 3): tối thiểu 20 case, dạng bảng `ID | Kịch bản | Kỳ vọng`. Bao gồm IDOR chéo workspace, VIEWER cố ghi, MEMBER xóa task người khác, reuse refresh token, token sau logout-all, join socket room trái phép, project archived.
8. **Thay đổi schema cần thiết** cho phần auth (cột/bảng mới cho users, refresh_tokens) — chỉ liệt kê, Engineer C (T-003) sẽ hợp nhất vào schema. Hãy SendMessage trực tiếp cho `taskflow-enterprise-ba` danh sách này ngay khi chốt để hai bên không lệch.

## Phạm vi sở hữu (chỉ được ghi)
- `docs/design/security.md`
- `docs/reviews/T-002-report.md`

## Phối hợp
- Engineer C (`taskflow-enterprise-ba`) đang làm data model + API contract (T-003). Thống nhất với C về: tên cột auth, mã lỗi (`error.code`), danh sách endpoint auth.
- Khi phân vân về quyết định lớn → hỏi Tech Lead `taskflow-enterprise-0b`.

## Hoàn thành khi
Đủ 8 mục; báo cáo xong; SendMessage `DONE T-002` cho `taskflow-enterprise-0b`.
