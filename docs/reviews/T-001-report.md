# T-001 Report — Nghiên cứu & khóa phiên bản stack

Engineer A (`taskflow-enterprise-50`) · 2026-10-15 · Kết quả: `docs/research/stack-versions.md`

## Đã làm
- Lấy dist-tags / peerDependencies / engines của ~60 gói trên npm registry; Node LTS từ `nodejs.org/dist/index.json`; tag image từ Docker Hub API.
- Đọc upgrade guide/changelog chính thức: Next 16.x, Express 5, Zod 4, Prisma 7 (+ trạng thái Prisma 8), Tailwind 4, TS 6/7, ESLint 10, Vitest 5, pnpm 11/12, OWASP Password Storage, giấy phép Redis, PostgreSQL versioning.
- **Kiểm chứng bằng chạy thật** (cài vào scratchpad ngoài repo, đã không đụng repo): Prisma 7.10 (`validate`, `migrate diff`, `generate`), Zod 4.6.7, fractional-indexing 4.0.0, benchmark bcrypt vs argon2id (2 thư viện), thử giới hạn 72 byte.
- Đối chiếu `docs/design/security.md` và trả lời toàn bộ 6 điểm `TODO(T-001)` trong `docs/design/data-and-api.md` (§7–§8 của file nghiên cứu).
- Phần bổ sung argon2id (yêu cầu ngày 2026-10-15): §9.

## File đã ghi
- `docs/research/stack-versions.md` (mới)
- `docs/reviews/T-001-report.md` (mới)
Không cài gói vào repo, không tạo `apps/`, không commit.

## Đề xuất thay đổi ADR (Tech Lead quyết)
1. **ADR-002**: "TypeScript 5.x" → **TypeScript 6.0.3**. TS 7.0 là `latest` nhưng không có API → typescript-eslint/dependency-cruiser không chạy.
2. **ADR-002**: Prisma pin **exact 7.10.0**; thêm luật "cấm `npx prisma` không pin" — dist-tag `latest` của `prisma` đang là 8.0.0-rc.22 với CLI khác hoàn toàn (đã tái hiện).
3. **ADR-002**: Redis 7/8 → **Redis 8.10** (AGPLv3) hoặc Valkey nếu pháp chế không nhận AGPL; PostgreSQL → **18.6**; Node → **24.22.0**.
4. **ADR-048 / security.md**: **argon2id (`@node-rs/argon2`, m=47104 t=1 p=1)** thay bcrypt cost 12. Kéo theo: bỏ luật "≤72 byte" (thay bằng max ~256 byte), sửa thời gian ≈250ms trong security.md & ghi chú ADR-030.
5. **ADR-004**: chọn bộ lint — Phương án A ESLint 10 không dùng `eslint-config-next` (đề xuất) hay B ESLint 9.39 (EOL) + `eslint-config-next`.
6. T-003 dòng 56: dùng `@@unique(..., where: raw(...))` native (preview `partialIndexes`) thay SQL tay.

## Quyết định tôi tự đưa ra (có thể bác)
- node-redis thay ioredis (redis.io khuyến nghị; ioredis best-effort).
- jose thay jsonwebtoken.
- fetch wrapper tự viết thay axios (12 advisory axios 09/2026).
- `@dnd-kit/react` 0.5 (pin exact) thay `@dnd-kit/core` legacy.
- pnpm 11.28.2 thay 12.x (bản Rust mới) dù `latest` = 12.
- `tsx` (dev) + `tsdown` (build) cho API; tsup không còn được bảo trì.
- Không turbo, không TS project references; `packages/contracts` dạng JIT (exports trỏ `.ts`).
- Image `node:24.22.0-bookworm-slim` thay alpine.

## Rủi ro
- **Prisma 8 GA dự kiến 10/2026**: docs prisma.io không gắn version đã chuyển sang v8 → dev phải đọc `/docs/orm/v7/`. Lockfile + pin exact là bắt buộc.
- `prisma.config.ts` với `env()` throw khi thiếu `DATABASE_URL` → build Docker fail; đã ghi cách dùng `process.env.DATABASE_URL ?? ""` (đã chạy thử).
- Prisma `update` throw P2025 thay vì trả 0 dòng — ảnh hưởng thiết kế cấp số task (T-003 §1.2).
- `@dnd-kit/react` còn 0.x; `partialIndexes` còn preview.
- ESLint 9 đã EOL; ESLint 10 chưa được `eslint-config-next` hỗ trợ trọn vẹn.
- Chưa test được trong container (Docker daemon máy dev không chạy) — Phase 1 cần smoke test native module (`@node-rs/argon2`, Prisma) trong image.
- Một số điểm UNVERIFIED nhỏ đã ghi rõ trong file (giấy phép Valkey, preset compiler rule chính xác của react-hooks).

## Câu hỏi mở cho Tech Lead
1. Duyệt argon2id (ADR-048)?
2. Lint: Phương án A hay B?
3. Redis 8 (AGPLv3) hay Valkey?
4. Dùng preview feature `partialIndexes` trong production hay giữ SQL tay?
5. pnpm 11 (đề xuất) hay 12?
