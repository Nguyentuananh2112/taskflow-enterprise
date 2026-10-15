# T-014 — Auth: domain model + use cases (TDD, InMemory)

**Giao cho:** Engineer B (`taskflow-enterprise-87`) · **Phase:** 2 (sớm) · **Phụ thuộc mềm:** T-009 (core của A), T-010 (schema của C)

## Nguồn
`docs/design/test-spec-auth-workspace.md` (phần Auth — bạn là tác giả) · `docs/design/security.md` §1–2 · `docs/design/data-and-api.md` §2.4 · DECISIONS (ADR-024–026, 049, 065, 093).

## Worktree
`../TaskFlow_wt/T-014`, branch `feat/T-014` từ `main` mới nhất (đã có T-013).

## Việc cần làm (test trước, theo đúng mã case trong test spec)
1. Domain: aggregate `User` (tokenVersion, deletedAt, passwordChangedAt…), `RefreshSession`/token family (rotation, reuse ⇒ thu hồi family, hạn trượt 7 ngày / tuyệt đối 30 ngày, cửa sổ ân hạn 10s), domain events cần thiết.
2. Ports repository: `IUserRepository`, `IRefreshTokenRepository`, `ISessionRevocationStore` (Valkey `sid-revoked`, `tv` cache), `IWorkspaceProvisioner` (port cho việc Register tạo workspace mặc định — module Workspace sẽ hiện thực, ADR-093).
3. Use cases: `Register`, `Login`, `RefreshSession`, `Logout`, `LogoutAll`, `ChangePassword`, `GetMe`, `UpdateMe` (ADR-083).
4. InMemory repositories + fakes để chạy unit test (đặt trong `infrastructure/persistence/in-memory/` hoặc `test/support` của module).
5. Middleware `authenticate` (HTTP) dưới dạng hàm thuần nhận `IAccessTokenService` + `ISessionRevocationStore` — chưa gắn route.

## Phối hợp với core (T-009 của A — đang làm song song)
- **KHÔNG tự viết** `BaseEntity`/`AggregateRoot`, `AppError`, `IUnitOfWork`, `IClock`, `IdGenerator`. Nhắn trực tiếp A (`taskflow-enterprise-50`) xin chốt **chữ ký** các interface này trước (A commit sớm phần `core/domain` + `core/errors` + `core/persistence` interface lên `feat/T-009` là đủ). Bạn có thể `git merge feat/T-009` vào branch của mình khi A báo interface đã ổn định — ghi rõ trong report.
- Thay `IClock`, `AuthDomainError` tạm của T-013 bằng bản core khi đã có.

## Không làm
Prisma repository (chờ T-010 merge — ticket sau), routes/controller (Phase 3), Socket auth.

## Phạm vi sở hữu
`apps/api/src/modules/auth/**`.

## Done
DoD; coverage domain auth ≥ 90%, application ≥ 80%; mọi case "tầng U" trong test spec phần Auth đều có test (bảng truy vết case → file test trong report). Nhắn `DONE T-014 feat/T-014`.
