# T-012 — Nền apps/web: design token, shared/ui, fetch wrapper, runtime config

**Giao cho:** Engineer E (`taskflow-enterprise-b7`) · **Phase:** 1b · **Phụ thuộc:** T-008 đã merge

## Nguồn
`docs/design/frontend.md` (bạn là tác giả, §2 FSD, §6 design system) · DECISIONS (ADR-004, 026, 060, 074, 081, 084) · `docs/design/security.md` §6.8 (CSP — W-CSP-*).

## Worktree
`../TaskFlow_wt/T-012`, branch `feat/T-012`.

## Việc cần làm
1. Cây FSD rỗng đúng §2 (`app/ widgets/ features/ entities/ shared/`) với `index.ts` public API.
2. Design token (sáng/tối) + Tailwind theo bản đã chốt; font; layout gốc tiếng Việt (`lang="vi"`).
3. `shared/ui`: Button, Input, Select, Badge, Avatar, Dialog, Drawer, Toast, Skeleton, EmptyState, Spinner — mỗi component ≤150 dòng, có story-like test (render + a11y cơ bản). Headless lib theo quyết định trong frontend.md.
4. `shared/api`: fetch wrapper (base URL từ runtime config, envelope parse, map `error.code` → lỗi có kiểu, header `X-Client-Id`, hook gắn Bearer + single-flight refresh **để trống phần auth** — Phase 4 nối). Unit test đầy đủ.
5. Runtime config: web đọc `API_URL` lúc chạy (không `NEXT_PUBLIC_*` cho URL) — cơ chế theo frontend.md.
6. CSP nonce cơ bản theo W-CSP-1..4 (nếu Next 16 cần `proxy`/middleware) — kiểm chứng docs chính thức, ghi nguồn.
7. Trang `/` và `/login` placeholder dùng shared/ui để chứng minh pipeline.

## Phạm vi sở hữu
`apps/web/**` (trừ Dockerfile của D).

## Done
DoD; Lighthouse a11y trang placeholder ≥ 90 (ghi số). Report `docs/reviews/T-012-report.md` trên branch. Nhắn `DONE T-012 feat/T-012`.
