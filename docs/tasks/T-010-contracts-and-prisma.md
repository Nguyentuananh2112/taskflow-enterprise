# T-010 — packages/contracts + Prisma schema + migration đầu + seed

**Giao cho:** Engineer C (`taskflow-enterprise-ba`) · **Phase:** 1b · **Phụ thuộc:** T-008 đã merge

## Nguồn
`docs/design/data-and-api.md` (toàn bộ — bạn là tác giả) · DECISIONS (ADR-011, 043, 060–062, 080, 081, 094, 095) · `docs/research/stack-versions.md` §8.

## Worktree
`../TaskFlow_wt/T-010`, branch `feat/T-010`.

## Việc cần làm
1. Sửa dòng purge job trong `data-and-api.md` theo ADR-095 (`pg_try_advisory_xact_lock`).
2. `packages/contracts`: mọi Zod schema theo §5 (body/query/params/DTO/envelope/mã lỗi/WS event payload), `ROLE_PERMISSIONS`, `Permission`, `ROLE_RANK`, `TASK_STATUS_TRANSITIONS` dạng dữ liệu thuần; locale `vi`; test cho từng schema (biên hợp lệ/không hợp lệ). Không có logic domain (§5.3).
3. `apps/api/prisma/schema.prisma` + `prisma.config.ts` đúng Prisma 7.10 (ADR-061, 062).
4. Migration đầu tiên: sinh bằng `pnpm exec prisma migrate dev --create-only`, rồi bổ sung SQL tay: collation "C" cho `tasks.rank`, CHECK constraint (email lowercase, ...), FK kép. Đảm bảo `prisma migrate diff` sau đó **rỗng** (ADR-062) — ghi lệnh kiểm vào report.
5. Seed dev (`prisma/seed.ts`): 2 workspace, đủ 4 role, 2 project (1 archived), ~30 task trải các trạng thái — dữ liệu giả, không PII thật.
6. Integration test tối thiểu cho các ràng buộc DB quan trọng (partial unique rank, FK kép chặn task sai workspace, unique (project, number)) — chạy với Postgres từ docker-compose của D (nếu T-011 chưa merge, dùng `docker run postgres:18.6` tạm và ghi lại).

## Phạm vi sở hữu
`packages/contracts/**`, `apps/api/prisma/**`, `apps/api/prisma.config.ts`, `docs/design/data-and-api.md`.

## Không làm
Repository/use case (Phase 2), core kernel (A).

## Done
DoD trong TEAM.md + migrate diff rỗng. Report `docs/reviews/T-010-report.md` trên branch. Nhắn `DONE T-010 feat/T-010`.
