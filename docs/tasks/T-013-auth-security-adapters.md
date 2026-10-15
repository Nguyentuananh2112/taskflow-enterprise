# T-013 — Adapter bảo mật cho module auth

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 1b · **Phụ thuộc:** T-008 đã merge

## Nguồn
`docs/design/security.md` (bạn là tác giả) · `docs/design/test-spec-auth-workspace.md` · DECISIONS (ADR-024–026, 049, 060, 065).

## Worktree
`../TaskFlow_wt/T-013`, branch `feat/T-013`.

## Việc cần làm (TDD)
Định nghĩa **port** ở `modules/auth/application/ports/` và **adapter** ở `modules/auth/infrastructure/security/`:
1. `IPasswordHasher` → `Argon2idPasswordHasher` (`@node-rs/argon2`, tham số ADR-065, `needsRehash`).
2. `PasswordPolicy` (domain value object hoặc service thuần): 12–256 ký tự, chuẩn hóa NFC, chặn danh sách mật khẩu phổ biến (file cục bộ, nguồn + giấy phép ghi trong report), không chứa email.
3. `IAccessTokenService` → `JoseAccessTokenService`: ký/verify theo claims trong security.md (`sub`, `tv`, `sid`, ...), hỗ trợ `JWT_ACCESS_SECRET_PREVIOUS` để xoay khóa, clock skew.
4. `IRefreshTokenFactory`: token opaque 32 byte, hash SHA-256, so sánh timing-safe.
5. Value object `Email` (trim, lowercase, NFC, độ dài).
Không phụ thuộc core của A (nếu cần `Clock`, định nghĩa tạm interface trong ticket này và ghi vào report để hợp nhất khi merge T-009).

## Phạm vi sở hữu
`apps/api/src/modules/auth/**` (chỉ các thư mục nói trên + test của chúng).

## Không làm
Use case Register/Login/Refresh, repository, routes (Phase 2).

## Done
DoD; coverage ≥ 90%; test chứng minh: mật khẩu > 72 byte không bị cắt, token hết hạn/sai chữ ký/sai `tv` bị từ chối, khóa cũ vẫn verify được trong thời gian xoay. Report `docs/reviews/T-013-report.md` trên branch. Nhắn `DONE T-013 feat/T-013`.
