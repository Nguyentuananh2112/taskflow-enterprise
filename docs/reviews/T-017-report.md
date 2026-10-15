# T-017 — Báo cáo (Engineer F, QA độc lập)

Session `taskflow-enterprise-bb` · Branch `feat/T-017` (rebase trên `main` 791f6fa) · 2026-10-15
Chi tiết kỹ thuật: [`T-017-findings.md`](T-017-findings.md) (lỗi bảo mật, mutation theo chủ module, ma trận SEC).

## 1. Đã làm

**Phần 1 — Mutation testing** (`apps/api/src/core/**`, `apps/api/src/modules/auth/**`)
- Kiểm chứng tương thích trước khi cài: `@stryker-mutator/vitest-runner` 10.0.0 **không dùng được** với Vitest 5 (stryker-js #6240, #6247/#6248, #6150) ⇒ báo TL, TL duyệt phương án **StrykerJS core 10.0.0 + `testRunner: "command"`**, `coverageAnalysis: "off"`, chia 6 nhóm, concurrency 2.
- Chạy cả 6 nhóm: tổng **84.18%** (1384 mutant). Yếu nhất: core/http 75.32%. Mỗi nhóm có 1 mutant kiểm chứng thủ công ⇒ 6/6 bị giết bởi đúng test kỳ vọng (runner không cho điểm giả).
- Phân loại toàn bộ 219 survivor thành **[GAP]** (kèm test đề xuất, ưu tiên P1–P3), **[EQ]** (tương đương — không ai cần làm), **[LOW]** (chuỗi log/thông điệp). Chia theo chủ module: core → A, auth → B.

**Phần 2 — Bộ test bảo mật đen** (`apps/api/test/security/`)
- Harness spawn **`src/main.ts` thật** (không gọi `createApp` trực tiếp) với Postgres 5434 (DB clone riêng mỗi file từ `taskflow_template`, xóa sau) + Valkey 6380 **db 15 riêng** (không đụng db 0 của server dev). Client HTTP thô (`node:http`) để kiểm soát Origin/Content-Type/Encoding; WebSocket thử bằng HTTP Upgrade thô (không thêm dependency).
- Dữ liệu dựng **chỉ qua API công khai** (`Actors`, `seedTenants`, `seedTasks`).
- Không có xanh giả: case chờ route ⇒ `skip` có nhãn `PENDING-ROUTE`; case chưa có thân ⇒ `todo`; suite realtime / rate-limit có **test đối chứng** (Origin hợp lệ ⇒ 101; header RateLimit có mặt) trước khi chạy case từ chối.
- Dùng làm **cổng nghiệm thu branch chưa merge**: `SEC_API_DIR=<worktree>/apps/api SEC_RUN_PENDING=<nhãn>`. Đã nghiệm thu T-016 (trên main sau merge) và T-021 (2 vòng).

## 2. Kết quả

| | main (a2adb8f) | T-021 @ 04c35f4 |
|---|---|---|
| Xanh | 42 | 52 |
| Đỏ | 3 (FINDING A5 — đã sửa ở T-021, chờ merge) | 0 |
| Skip / todo | 15 / 49 | 8 / 49 |

Lỗi tìm được (đều đã báo ngay khi phát hiện):

| # | Mức | Ở đâu | Trạng thái |
|---|---|---|---|
| A1 | Medium | T-016 né rate limit bằng `Authorization` rác | Đã sửa (rev2), cổng xanh |
| A2 | Low | T-016 TOCTOU `project:join` | Đã sửa (rev2), A có unit test |
| A3 | Low-Medium | T-014 thu hồi phiên fail-open khi **ghi** cache lỗi | **Mở** — chờ TL/B quyết |
| A4 | High nếu hiện thực ngây thơ | `IUserRepository.save` lost update (đổi mật khẩu / logout-all bị hoàn tác) | **Mở** — phải chốt trước PrismaUserRepository (T-020) |
| A5 | Low | JSON charset utf-7/utf-16 được chấp nhận | Đã sửa trên T-021 (04c35f4) |
| A6 | Medium (dev/e2e) | T-021 InMemoryUnitOfWork chạy lồng khi đồng thời ⇒ user mồ côi | Đã sửa trên T-021 (04c35f4) |

## 3. File

- `apps/api/stryker/base.mjs`, `apps/api/stryker/<nhóm>.config.mjs` (6 file) — cấu hình Stryker. Lưu ý: ticket ghi `stryker.config.*`; tôi đặt trong thư mục `stryker/` để 6 nhóm không làm rối gốc `apps/api` (tên file vẫn `*.config.mjs`).
- `apps/api/test/security/**` — harness (`harness/{config,database,api-process,http-client,suite,actors,valkey}.ts`), `vitest.config.ts`, suite `transport|rate-limit|realtime|auth|tenant|production.sec.ts`.
- `apps/api/package.json` — devDependency **`@stryker-mutator/core` 10.0.0** (pin chính xác); script `mutation:<nhóm>` ×6 và `test:security`. `pnpm-lock.yaml` cập nhật tương ứng.
- `docs/reviews/T-017-findings.md`, `docs/reviews/T-017-report.md`.
- **Không** sửa `apps/*/src/**`. (Mutant kiểm chứng thủ công sửa tạm 6 file src rồi khôi phục bằng bản sao lưu; `git status src` sạch — không commit.)

## 4. Quyết định tự đưa ra (cần TL xác nhận)

1. Stryker devDependency ghi **thẳng** version `10.0.0` trong `apps/api/package.json`, không qua `catalog:` — `pnpm-workspace.yaml` ngoài phạm vi sở hữu. Đề xuất TL chuyển vào catalog.
2. Script `mutation:*` / `test:security` thêm vào `apps/api/package.json` (TL yêu cầu `pnpm mutation:<nhóm>`; file này ngoài phạm vi ghi trong ticket).
3. Bộ test bảo mật dùng hậu tố **`.sec.ts`** + config riêng ⇒ **không** chạy trong `pnpm test`/CI mặc định (cần DB + Valkey + spawn process). Đề xuất job CI riêng có service container (D quyết).
4. Suite dùng Valkey **db 15** và `FLUSHDB` db đó trước mỗi file; helper từ chối flush nếu URL không trỏ db 1–15.
5. Request chưa xác thực của harness mang `X-Forwarded-For` ngẫu nhiên (API chạy `TRUST_PROXY_HOPS=1`) để seed nhiều user không chạm rate limit register 5/giờ/IP; riêng `rate-limit.sec.ts` chạy `hops=0`.

## 5. Rủi ro / câu hỏi mở

- **A3, A4 còn mở** — A4 phải chốt trước khi viết repository Prisma; cổng SEC-21c/23b hiện xanh trên InMemory nhưng chỉ có ý nghĩa thật khi chạy trên Postgres.
- SEC-35..39, 41 (socket auth/phòng) cần **`socket.io-client`** làm devDependency — xin TL duyệt trước khi thêm.
- SEC-24/24b cần dừng/khởi động container Valkey trong test — cần TL đồng ý cho suite điều khiển `docker` (hiện chỉ thao tác dữ liệu, không thao tác container).
- 49 case `todo` (SEC-13..17, 19, 20, 22..24, 26..28, 32, 34..39, 41, 46, 47, 51..55, GATE-T016-401): viết tiếp trên route T-021 khi merge; nhóm task (SEC-02..12, 42..46) chờ T-018.
- Đề xuất **bộ contract test chung** cho `IUserRepository` / `IRefreshTokenRepository` / `ISessionRevocationStore` (InMemory + Prisma/Valkey) — gom nhiều [GAP] P1 của auth/infrastructure và là cổng cho A4.

## 6. Definition of Done (trong `../TaskFlow_wt/T-017`, sau rebase lên 791f6fa)

```
pnpm typecheck  → exit 0 (api + web + packages)
pnpm lint       → exit 0 (prettier --check, eslint --max-warnings=0, depcruise api 195 modules / web 92 modules: no violations)
pnpm test       → exit 0 — Test Files 79 passed (79), Tests 802 passed (802)  [3 lần liên tiếp]
```
Ghi nhận trung thực: lần chạy `pnpm test` **đầu tiên** sau rebase báo `68 passed / 717 passed` nhưng exit 1 (chạy nối tiếp ngay sau `pnpm typecheck` + `pnpm lint` trong cùng lệnh, lúc vừa thêm shim `pnpm.cmd`); không tái hiện được qua 3 lần chạy lại — không tìm được nguyên nhân, ghi lại để TL biết.

Suite bảo mật (ngoài DoD): `pnpm --filter @taskflow/api test:security` trên main ⇒ 42 xanh, 3 đỏ (A5 — đã sửa ở T-021), 15 skip, 49 todo.
Mutation: `pnpm --filter @taskflow/api mutation:<nhóm>` — tổng ~56 phút cho 6 nhóm trên máy dev (~5 GB RAM trống); đề xuất CI hằng tuần.
