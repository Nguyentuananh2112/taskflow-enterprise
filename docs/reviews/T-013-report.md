# T-013 Report — Adapter bảo mật cho module auth

**Người làm:** Engineer B · **Branch:** `feat/T-013` (từ `main` 5f4a584, chưa có commit mới trên main nên không cần rebase) · **Ngày:** 2026-10-15

## Đã làm (TDD: test đỏ trước, rồi hiện thực)

| Mục ticket | File | Ghi chú |
|---|---|---|
| 5. `Email` (domain) | `domain/email.ts` | trim → NFC → lowercase; 1 `@`, local 1–64, domain ≥ 2 nhãn không rỗng, tổng ≤ 254 (khớp `VarChar(254)`), không khoảng trắng. Lỗi `AuthDomainError('INVALID_EMAIL')` không chứa giá trị email (PII). |
| 2. `PasswordPolicy` (domain, thuần TS) | `domain/password-policy.ts` | 12–256 ký tự = code point sau NFC; `COMMON` (so chữ thường); `CONTAINS_EMAIL` (phần local ≥ 3 ký tự, không phân biệt hoa thường); trả **mọi** vi phạm theo thứ tự cố định. Danh sách phổ biến được tiêm (`ReadonlySet`), domain không đọc file. |
| 1. `IPasswordHasher` → `Argon2idPasswordHasher` | `application/ports/password-hasher.port.ts`, `infrastructure/security/argon2id-password-hasher.ts` | argon2id m=47104 t=1 p=1 (ADR-065). **NFC bên trong cả `hash` và `verify`**. `verify(null, pw)` verify với hash giả cùng tham số (tạo sẵn lúc `create()`, không lười) ⇒ cân thời gian. `needsRehash` dùng `parseOptions()`. Mật khẩu > 256 ký tự: `verify` trả `false` không gọi argon2 (chống DoS), `hash` ném `RangeError`. Hash hỏng ⇒ `false`, không ném. |
| 3. `IAccessTokenService` → `JoseAccessTokenService` | `application/ports/access-token-service.port.ts`, `infrastructure/security/jose-access-token-service.ts` | jose 6, HS256 + whitelist `algorithms`, `iss`/`aud`, claims `sub tv sid jti iat exp` (không role/email/workspace), TTL 900s, `clockTolerance` 5s, `currentDate` lấy từ `IClock`. Xoay khóa: header `kid` = 16 ký tự đầu SHA-256(secret) base64url; key resolver chỉ nhận `kid` của secret hiện tại hoặc `previousSecret`. Kết quả `{ok:false, reason:'expired'\|'invalid'}` — không ném. Secret < 32 byte ⇒ lỗi lúc khởi tạo. |
| 4. `IRefreshTokenFactory` → `CryptoRefreshTokenFactory` | `application/ports/refresh-token-factory.port.ts`, `infrastructure/security/crypto-refresh-token-factory.ts` | 32 byte `randomBytes` → base64url (43 ký tự); SHA-256 hex; `matches` dùng `timingSafeEqual`, hash sai định dạng ⇒ `false`. |
| Danh sách mật khẩu phổ biến | `infrastructure/security/common-password-list.ts`, `data/common-passwords.json`, `data/LICENSE-common-passwords.md` | Xem mục "Nguồn danh sách". Import JSON (không đọc file lúc chạy) ⇒ tsdown đóng gói được — **đã kiểm**: bundle riêng module này ra `common-password-list.js` 860 kB (gzip 337 kB), nạp được 46 146 mục. |
| `IClock` tạm | `application/ports/clock.port.ts` | `TODO(T-009)` — thay bằng clock của core. |
| `AuthDomainError` tạm | `domain/auth-domain-error.ts` | `TODO(T-009)` — hợp nhất vào cây `AppError` của core. |
| security.md (mở rộng phạm vi, commit 3b02548) | `docs/design/security.md` 1.2 bước 5 và 6.5 | needsRehash dùng `parseOptions`; thêm gạch đầu dòng **NFC trước hash VÀ verify** — **phát hiện bởi Engineer C** (`taskflow-enterprise-ba`). |

Đường dẫn trên tương đối với `apps/api/src/modules/auth/`.

### Test chứng minh yêu cầu "Done" của ticket
- **Mật khẩu > 72 byte không bị cắt:** `argon2id-password-hasher.test.ts` — 80 ký tự giống nhau + hậu tố khác ⇒ `false`; mật khẩu tiếng Việt dài khác ở cuối ⇒ `false`.
- **Token hết hạn / sai chữ ký / sai claim bị từ chối:** `jose-access-token-service.test.ts` — 904s qua, 906s `expired`; sửa chữ ký, sửa payload, `alg: none`, HS512 cùng secret, secret khác, sai `iss`/`aud`, thiếu `tv`/`sid`/`sub`/`jti`, `tv` không nguyên/âm, chuỗi rác ⇒ `invalid`. (So `tv` với giá trị **hiện tại** trong cache là việc của middleware `authenticate` ở Phase 2 — adapter chỉ đảm bảo `tv` có mặt và hợp lệ.)
- **Khóa cũ verify được trong thời gian xoay:** token ký bằng S1 verify được bởi service (secret S2, previous S1); service (S3, previous S2) từ chối token S1; thiếu `kid` ⇒ `invalid`.
- **NFC vs NFD:** băm NFD verify NFC và ngược lại ⇒ `true`.

### Phụ thuộc mới (TEAM.md "Quy trình code" mục 3)
`pnpm-workspace.yaml` catalog + `apps/api/package.json`: `@node-rs/argon2` 2.2.2 (**trùng khớp nguyên văn** dòng của D/T-011 theo yêu cầu Tech Lead), `jose` 6.2.12, `@vitest/coverage-v8` 5.0.4 (dev — để đo coverage theo ticket). Cả ba đã > 24h tuổi (không cần `minimumReleaseAgeExclude`). `pnpm-lock.yaml` thay đổi theo.

## Definition of Done (chạy trong worktree, Windows, Node 24.18.0, pnpm 11.28.2 qua corepack)

```
$ pnpm typecheck
packages/config typecheck: Done · packages/contracts typecheck: Done · apps/api typecheck: Done · apps/web typecheck: Done

$ pnpm lint
prettier --check . && eslint . --max-warnings=0 && pnpm -r lint:deps
apps/web lint:deps: ✔ no dependency violations found (12 modules, 10 dependencies cruised)
apps/api lint:deps: ✔ no dependency violations found (28 modules, 34 dependencies cruised)

$ pnpm test
 Test Files  12 passed (12)
      Tests  149 passed (149)        (module auth: 6 file, 75 test)

$ pnpm exec vitest run --project api --coverage.enabled --coverage.include='**/modules/auth/**' --coverage.exclude='**/*.test.ts'
Statements   : 97.5% ( 117/120 )
Branches     : 96.29% ( 78/81 )
Functions    : 100% ( 29/29 )
Lines        : 100% ( 105/105 )
(chỉ jose-access-token-service.ts < 100%: 3 nhánh phòng thủ — thiếu khóa ký hiện tại, `iat`/`exp` không phải số sau khi jose đã kiểm requiredClaims)

$ pnpm --filter @taskflow/api build
✔ Build complete (main.ts chưa import module auth — đã kiểm đóng gói JSON riêng như trên)
```

ESLint ép `domain/` không import `@node-rs/*`, `jose`, `zod` — `email.ts`, `password-policy.ts`, `auth-domain-error.ts` thuần TS, qua lint. dependency-cruiser xác nhận `application/ports` không import `infrastructure`.

## Nguồn danh sách mật khẩu phổ biến
SecLists `xato-net-10-million-passwords-1000000.txt` (MIT, © 2018 Daniel Miessler), lọc 12–256 ký tự ASCII in được, chữ thường, bỏ trùng ⇒ 46 146 mục. Giấy phép MIT đầy đủ + lệnh tái tạo ở `data/LICENSE-common-passwords.md` (đã so khớp nguyên văn với file LICENSE của SecLists). Lý do chọn bản 1M: bản 100k chỉ còn 483 mục sau khi lọc ≥ 12 ký tự.

## Quyết định tự đưa ra
1. `IPasswordHasher.verify(hashed: string | null, …)` — đưa việc cân thời gian (DUMMY_HASH) **vào adapter** thay vì để use case tự làm; hash giả tạo sẵn trong `create()` (factory async).
2. `verify` trả `false` ngay với mật khẩu > 256 ký tự (không gọi argon2). Đánh đổi: thời gian phản hồi lộ "mật khẩu quá dài" — không lộ gì về tài khoản.
3. `IAccessTokenService.verify` trả union `{ok, reason}` thay vì ném lỗi — middleware map `expired`→`TOKEN_EXPIRED`, `invalid`→`UNAUTHORIZED` mà không cần bắt kiểu lỗi của jose.
4. `kid` sinh từ SHA-256(secret) (không cần biến môi trường riêng cho kid). Token thiếu `kid` bị từ chối.
5. Kiểm "chứa email" chỉ khi phần local ≥ 3 ký tự.
6. `@vitest/coverage-v8` thêm vào devDependencies của `apps/api` (không sửa `vitest.config.ts` — coverage chạy bằng cờ CLI).

## Rủi ro
- **Kích thước:** `common-passwords.json` 906 kB trong repo, ~860 kB trong bundle API, Set ~46k chuỗi trong RAM (vài MB). Nếu cần nhỏ hơn: bản 100k (483 mục) — ít bảo vệ hơn nhiều.
- **Bộ nhớ argon2:** 46 MiB/lần băm; `create()` tốn 1 lần băm lúc khởi động (~30 ms). Kiểm chứng trong container vẫn là việc của D (T-011).
- `Number(current.algorithm)` so với hằng số do `Algorithm`/`Version` là const enum ambient không dùng được với `isolatedModules` — nếu thư viện đổi giá trị enum ở bản sau thì test `needsRehash` (argon2i ⇒ true) sẽ bắt.

## Câu hỏi mở / việc hợp nhất khi T-009 merge
- Thay `IClock` (port tạm) và `AuthDomainError` bằng bản của core; map `INVALID_EMAIL` sang `VALIDATION_ERROR` 400 ở presentation.
- Env: `JWT_ACCESS_SECRET`, `JWT_ACCESS_SECRET_PREVIOUS` cần vào `src/config/env.ts` (thuộc T-009/T-011) kèm kiểm tra placeholder/`test-only-` ở production (security.md 6.9). Adapter đã tự chặn secret < 32 byte.
- **Môi trường:** `pnpm` không có trên PATH (chỉ corepack); script lồng (`pnpm -r …`) cần `pnpm` thật. Tôi dùng shim tạm trong scratchpad (gọi `corepack pnpm`) thay vì `corepack enable` (thay đổi toàn cục). Nên ghi hướng dẫn vào README.
