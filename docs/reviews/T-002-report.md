# T-002 Report — Thiết kế bảo mật

**Người làm:** Engineer B (`taskflow-enterprise-87`) · **Ngày:** 2026-10-15

## Đã làm
- Viết `docs/design/security.md` đủ 8 mục của ticket + mô hình mối đe dọa ngắn.
- 40 test case bảo mật (SEC-01 → SEC-40), phủ đủ các kịch bản ticket yêu cầu.
- Phối hợp với Engineer C (`taskflow-enterprise-ba`): C gửi dự thảo cột auth + mã lỗi; B trả lại bản chốt (schema, mã lỗi, 7 endpoint auth, danh mục permission chính thức, quy ước repository có phạm vi tenant, event socket mới). Hai bên khớp ~90% ngay từ đầu.

## File
- `docs/design/security.md` (mới)
- `docs/reviews/T-002-report.md` (mới)
Không sửa file nào khác, không commit.

## Quyết định tự đưa ra (cần Tech Lead duyệt)
1. **Refresh token opaque** (32 byte ngẫu nhiên), không phải JWT ⇒ bỏ `JWT_REFRESH_SECRET` khỏi env.
2. **Hạn refresh**: trượt 7 ngày, tuyệt đối 30 ngày (thêm cột `family_expires_at`).
3. **Cửa sổ ân hạn 10s** cho race refresh nhiều tab: trả `409 REFRESH_IN_PROGRESS`, không cấp token và không thu hồi family. FE single-flight bằng Web Locks.
4. **Claim `sid` (= familyId)** trong JWT + Redis `auth:sid-revoked:{familyId}` để logout 1 thiết bị hủy access token ngay. Middleware dùng `MGET` 1 round-trip.
5. **Membership đọc DB mỗi request**, không cache ở v1.
6. **Mật khẩu tối thiểu 15 ký tự** (theo NIST SP 800-63B-4 cho mật khẩu một yếu tố), tối đa 72 byte (bcrypt).
7. **Rate limit fail-closed cho login/register** khi Redis lỗi, fail-open cho phần còn lại.
8. **Kiểm tra `Origin`** trên `/auth/refresh` và `/auth/logout` (lớp thêm ngoài SameSite=Strict).
9. Dev cookie: tên `tf_rt`, không `Secure`. Prod: `__Secure-tf_rt`. App từ chối khởi động nếu prod mà `COOKIE_SECURE=false`.
10. Socket là kênh chỉ đọc; thêm event `auth:renew`, `auth:expired`, `workspace:access-revoked`; room `user:{id}`, `session:{sid}`.
11. Thứ tự kiểm tra cố định 401 → 404 → 403 → 422 → 409; uuid sai định dạng ⇒ 400.

## Câu hỏi mở cho Tech Lead
1. **Enumeration ở register**: v1 trả `409 EMAIL_ALREADY_EXISTS` (lộ email đã đăng ký) vì chưa có hạ tầng email để làm luồng "luôn 202 + gửi mail xác minh". Chấp nhận cho v1? Có đưa email verification vào roadmap không?
2. **MEMBER sửa nội dung task của người khác?** Ma trận 1.2 không nói. Tôi giả định CÓ (Kanban cộng tác), giống quyền move.
3. ~~Quy tắc assign của MEMBER~~ — **đã chốt với C**: `task:assign:own` = đổi assignee task mình tạo, hoặc tự nhận/bỏ nhận; khi tạo task MEMBER chỉ để trống hoặc tự gán.

## Đồng bộ sau DONE (với contract T-003)
Endpoint `PATCH …/assignee`, thêm `POST /workspaces`, socket `member:role-changed` + vỏ event chung + `clientId`, header `X-Client-Id` (không phải thông tin xác thực), `VERSION_CONFLICT.details.current`. Test bảo mật tăng lên SEC-42.
4. **Giới hạn 72 byte** ⇒ mật khẩu tiếng Việt có dấu tối đa ~24–36 ký tự. Phương án nới: pre-hash `bcrypt(base64(HMAC-SHA256(pepper, pw)))` — phức tạp hơn, cần quản lý pepper. Đề xuất giữ 72 byte cho v1.
5. Mức tối thiểu 15 ký tự khắt khe hơn thói quen người dùng; có muốn hạ xuống 12 không (lệch NIST)?

## Rủi ro
- **XSS ở web = mất access token** (sống trong bộ nhớ JS, ADR-026). Giảm thiểu bằng TTL 15 phút + CSP nonce bắt buộc ở Phase 4. Ticket Phase 4 cần mục CSP riêng.
- **`trust proxy` cấu hình sai** sẽ làm rate limit vô dụng hoặc khóa nhầm toàn bộ người dùng. Cần xác nhận topology deploy (số hop proxy) ở Phase 5.
- Nguồn NIST mới chỉ đối chiếu qua bài viết thứ cấp; cần đối chiếu bản gốc. Tên package và phiên bản (helmet, express-rate-limit, rate-limit-redis, jose/jsonwebtoken, bcrypt/bcryptjs) phụ thuộc T-001.

## Đề xuất ngoài phạm vi (Tech Lead quyết)
- Bỏ `JWT_REFRESH_SECRET`, thêm `JWT_ACCESS_SECRET_PREVIOUS`, `CORS_ORIGINS`, `COOKIE_SECURE`, `TRUST_PROXY_HOPS` vào `.env.example` ở Phase 1.
- Có thể ghi thành ADR: các quyết định số 2, 3, 4, 6 ở trên.

## T-002b (bổ sung sau review, 2026-10-15)
Chỉ sửa `docs/design/security.md`:
- **3.5 (mới):** LAST_OWNER chống race (ADR-046) bằng `SELECT … FOR UPDATE` trên mọi dòng OWNER của ws, khóa theo thứ tự `id` để không deadlock. Mọi thao tác làm giảm số OWNER đi qua một hàm duy nhất. Assignee phải ≥ MEMBER (ADR-044): gán thì `FOR SHARE` membership, hạ xuống VIEWER/xóa thì bỏ gán trong cùng transaction (audit + event).
- **3.6 (mới):** workspace xóa mềm (ADR-047). `loadMembership`, socket join, `GET /workspaces`, `/auth/me` coi ws đã xóa là không tồn tại (404 cho mọi người kể cả OWNER). Kiểm tra lặp ở UseCase. Endpoint khôi phục (nếu làm) phải là route riêng.
- **6.8 (mới):** yêu cầu CSP nonce + chống XSS cho Phase 4, mã W-CSP-1..5, W-XSS-1, W-TOKEN-1, sẵn để đưa vào ticket.
- Áp ADR-045 (archived cấm xóa task) và ADR-042 (task xóa mềm ⇒ 404) vào bảng permission, 4.2 và SEC-10. Ghi chú ADR-048/049 ở 6.5.
- Test: thêm SEC-43 → SEC-50 (assignee VIEWER, bỏ gán khi hạ role, 2 test race, ws xóa mềm, 3 test E2E CSP/XSS).

Lưu ý cho Engineer C / Phase 1: luật bỏ gán khi hạ role và khóa LAST_OWNER cần `workspace_members` có index `(workspace_id, role)` để câu `FOR UPDATE` không quét cả bảng (đề xuất, C quyết).

- **T-002c (đồng bộ T-003b):** thêm yêu cầu bảo mật cho `POST /workspaces/:wsId/restore` và `GET /workspaces?deleted=true` (C đề xuất, **chưa có ADR** — ghi là chờ duyệt), ghi rõ không có cache membership; test SEC-51 → SEC-55 (chỉ áp dụng nếu restore được duyệt).
