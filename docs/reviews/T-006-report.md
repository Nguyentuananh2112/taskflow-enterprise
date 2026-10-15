# T-006 Report — Đặc tả test Auth & Workspace

**Người làm:** Engineer B (`taskflow-enterprise-87`) · **Ngày:** 2026-10-15

## Đã làm
- `docs/design/test-spec-auth-workspace.md`: đặc tả Given/When/Then cho:
  - **Auth:** Register, Login, Refresh, Logout, LogoutAll, ChangePassword, middleware `authenticate` và handshake socket.
  - **Workspace:** Create, List/Get, Update, Delete, Restore.
  - **Member:** Add, ChangeRole, Remove/Leave.
  - **Project:** Create, Update, Archive/Unarchive.
- Tổng cộng 156 case, mỗi case ghi tầng U (InMemory + fake) / I (Postgres + Redis thật) và map tới SEC-xx.
- §0 định nghĩa bộ fake/port cần có cho TDD. Danh sách port là đề xuất, sẽ chốt khi code Phase 2.
- §5 có ma trận phủ: mọi SEC thuộc phạm vi auth/workspace/member/project đều có ít nhất một case. Liệt kê rõ các SEC nằm ngoài phạm vi (Task domain, socket join/renew, CORS, E2E).

## Đồng bộ security.md theo quyết định mới (trước T-006, theo yêu cầu của Tech Lead)
- ADR-049: mục 6.5 đổi thành tối thiểu 12 ký tự, ghi rõ lệch NIST 15 có chủ đích và biện pháp bù. Register 409 được chấp nhận. Sửa SEC-32 thành 11/12 ký tự.
- ADR-050: bỏ nhãn "chờ duyệt" ở restore; SEC-51..55 nhập vào bảng chính (bắt buộc). Ghi slug được giữ chỗ.
- ADR-051: ghi index `(workspace_id, role)` ở 3.6.
- **Tự sửa thêm (cần Tech Lead biết):** mục 6.5 trước đây đề xuất `member:add` với email chưa có tài khoản trả 422 chung chung. Contract T-003 lại trả `404 resource:"user"`. Tôi theo contract, vì register đã lộ email (ADR-049) nên không có rò rỉ mới. Bù lại bằng rate limit `POST ws/members` 30/giờ/user. Cũng thêm vào bảng 6.4 hai giới hạn đã nêu rải rác: `POST /workspaces` 10/giờ, `POST ws/restore` 10/giờ.

## Quyết định tự đưa ra trong spec
1. Mọi test race chỉ ở tầng I, lặp 20 lần, gom một file chạy tuần tự.
2. "404 chuẩn" = so khớp byte-for-byte với response của uuid không tồn tại.
3. `member:add`: kiểm Policy cấp role (403) **trước** khi tra user (404) (MEM-03).
4. Đổi role sang chính role hiện tại ⇒ 200, không audit/event (ROL-08), theo tinh thần R15 của T-003.
5. Login khi Redis lỗi ⇒ `503` (hệ quả của rate limit fail-closed, security.md 6.4) — LOG-11.

## Câu hỏi mở
1. ~~Định dạng slug/name~~ — **đã chốt** với C (R19 trong `data-and-api.md`): đúng như giả định. Đã thêm WSC-04b, WSC-08 (slug dành riêng ⇒ 409, giống slug đã có người dùng), WSC-09, WSC-10, WSU-04, REG-13b; đổi số lần thử khi trùng slug từ 3 → 5 (REG-12, security.md 1.1).
2. ~~Dòng register 409 ở `data-and-api.md` 2.4~~ — C đã sửa theo ADR-049.
3. Danh sách port ở §0.2 phụ thuộc cấu trúc module mà Engineer A dựng ở Phase 1. Nếu khác thì tôi điều chỉnh tên khi bắt đầu Phase 2, nội dung case không đổi.

## Rủi ro
- LOG-08 (so thời gian) có thể chập chờn trên CI chậm. Đề xuất đánh dấu là test riêng, chạy với số mẫu lớn hơn, và cho retry 1 lần.
- Test race phụ thuộc pool kết nối ≥ 2. Cấu hình test DB phải đảm bảo điều này.
