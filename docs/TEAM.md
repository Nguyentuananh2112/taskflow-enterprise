# TEAM — Quy trình phòng IT TaskFlow

## Vai trò
| Session | Vai trò | Ghi chú |
|---|---|---|
| `taskflow-enterprise-0b` | **Tech Lead / Kiến trúc sư** | Ra quyết định, viết ticket, review, merge. Không ai khác sửa `docs/blueprint/DECISIONS.md`. |
| `taskflow-enterprise-50` | **Engineer A — Platform/Research** | Hạ tầng, tooling, nghiên cứu công nghệ, sau này: Auth. |
| `taskflow-enterprise-87` | **Engineer B — Security/Backend** | Thiết kế bảo mật, sau này: Workspace/Project/RBAC. |
| (tạm nghỉ — `-d7` crash, mở lại khi cần) | **Engineer C — Domain/Contracts** | Data model, API contract, sau này: Task domain. |
| `taskflow-enterprise-a5` | **Engineer D — QA/DevOps** | Vận hành production, CI/CD, chiến lược test; sau này: test độc lập (bảo mật/IDOR/E2E), pipeline. |
| `taskflow-enterprise-54` (thay `-b7`, `-37`) | **Engineer E — Frontend** | Kiến trúc FE & UX; sau này: Kanban board, realtime phía client. |
| `taskflow-enterprise-bb` | **Engineer F — QA/Tester độc lập** | Mutation testing, bộ test bảo mật đầu-cuối SEC-01..58, sau này E2E. Chỉ ghi thư mục test, không sửa code sản phẩm. |

## Nguồn sự thật (đọc theo thứ tự ưu tiên)
1. `docs/blueprint/DECISIONS.md` (v1.1) — ghi đè mọi thứ khác.
2. Ticket của bạn trong `docs/tasks/`.
3. `docs/design/*`, `docs/research/*` đã được Tech Lead duyệt.
4. `docs/blueprint/PROJECT_BLUEPRINT_v1.0.md` — chỉ tham chiếu ý định, code mẫu có lỗi.

## Luật làm việc
1. **Chỉ sửa file/thư mục ticket giao cho bạn** (mục "Phạm vi sở hữu"). Cần sửa ngoài phạm vi → ghi vào báo cáo, để Tech Lead quyết.
2. **Không commit, không đổi branch** trừ khi ticket cho phép. Tech Lead commit sau khi review.
3. Phát hiện mâu thuẫn hoặc thiếu thông tin → **dừng và hỏi Tech Lead** qua SendMessage tới `taskflow-enterprise-0b`, đừng tự đoán ở quyết định lớn.
4. Không đưa thông tin bịa: số phiên bản, API thư viện phải kiểm chứng (docs chính thức / npm registry). Ghi nguồn.
5. **Không ghi vào memory của Claude** (`~/.claude/projects/d--TaskFlow-Enterprise/memory/`) — thư mục này dùng chung cho mọi session, ghi "tôi là Engineer X" sẽ làm các session khác hiểu sai vai trò. Ngữ cảnh dự án nằm trong `docs/`.
6. Xong việc: viết báo cáo vào `docs/reviews/<TICKET>-report.md` (đã làm gì, file nào, quyết định tự đưa ra, rủi ro, câu hỏi mở), rồi **SendMessage cho `taskflow-enterprise-0b`** dòng đầu: `DONE <TICKET>`.

## Quy trình code (từ Phase 1) — mỗi người một git worktree
1. Tạo worktree riêng từ `main`: `git worktree add ../TaskFlow_wt/<TICKET> -b feat/<TICKET> main` rồi làm việc **trong thư mục đó**, không làm trong `D:\TaskFlow_Enterprise`.
2. Được commit trên branch `feat/<TICKET>` của mình (kết thúc commit message bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). **Không merge vào `main`, không push** — chỉ Tech Lead merge.
3. Chỉ sửa file trong "Phạm vi sở hữu" của ticket. Cần thêm dependency → `pnpm add --filter <pkg>` trong worktree của mình; xung đột `pnpm-lock.yaml` Tech Lead xử lý lúc merge.
4. Trước khi báo DONE: rebase lên `main` mới nhất, chạy Definition of Done, ghi kết quả lệnh vào báo cáo.
5. Không bao giờ commit `.env`, secret, dữ liệu thật (repo sẽ public — ADR-072).

## Definition of Done (từ Phase 1 trở đi)
`pnpm typecheck && pnpm lint && pnpm test` xanh · không vi phạm ADR-004 · test cho mọi luật nghiệp vụ mới · báo cáo đã gửi.

## Lộ trình
| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Chốt thiết kế: T-001..T-007 | ✅ Xong |
| 1a | T-008 khung monorepo + tooling (A) · đồng bộ tài liệu (B, C, D, E) | ✅ Xong (ee7049f) |
| 1b | T-009 core kernel (A) · T-010 contracts + Prisma (C) · T-011 Docker + CI (D) · T-012 nền web + shared/ui (E) · T-013 adapter bảo mật auth (B) | 🟢 Đang chạy |
| 2 | Backend: ✅ T-013 adapter bảo mật · ✅ T-009 core · ✅ T-014 auth use cases · 🟢 T-015 Workspace (B) · 🟢 T-016 realtime + rate limit (A) · ⏳ Task domain (C, sau T-010) | 🟢 Đang chạy |
| 3 | Tích hợp: Prisma repos, routes, audit trong transaction, Socket gateway, test IDOR | ⏳ |
| 4 | Frontend song song: shell + auth · Kanban board | ⏳ |
| 5 | E2E, k6, security review, deploy | ⏳ |

## Môi trường test dùng chung (ADR-106)
- Postgres test (cổng 5434) dùng chung, harness integration **xóa schema `public`** của DB đích ⇒ **mỗi người một database riêng** tạo từ quyền CREATEDB của `taskflow_migrator`: `taskflow_<ticket>` (vd `taskflow_t020`), suite đen của QA dùng `taskflow_sec`. **Cấm** trỏ test vào `taskflow_template` hoặc DB dev (5435).
- Valkey (6380) dùng chung: test dùng prefix key riêng hoặc DB index riêng.
- Container tạm riêng (cổng khác) được phép, phải tự dọn khi xong. Không bao giờ dừng/sửa compose `taskflow` dùng chung hoặc container của dự án khác.

## Giảm tải máy dev (ADR-107) — bắt buộc
Máy dev dùng chung có RAM/IO hạn chế; cấu hình máy (Defender, Dev Drive…) **giữ nguyên** theo quyết định của người dùng. Vì vậy:
1. **Dùng lại worktree cũ** cho ticket mới thay vì tạo worktree mới: trong worktree hiện có của bạn, `git fetch` (không cần) → `git switch -c feat/<TICKET> main` (sau khi đã commit hết việc cũ). `pnpm install` lúc đó chỉ cài phần chênh lệch — vài chục giây thay vì 25–45 phút. Chỉ tạo worktree mới khi thật cần chạy 2 branch song song.
2. Vitest: dùng mặc định của repo (`VITEST_MAX_WORKERS`, 4 local) hoặc thấp hơn (`--maxWorkers=2`) khi máy bận — chỉ cho unit, KHÔNG cho `test:integration` (luôn tuần tự, runbook local-dev §5); luôn kiểm **exit code**.
3. Việc nặng (Stryker, k6, `docker build`, `next build` nhiều lần, Playwright) **không chạy cùng lúc với việc nặng khác của chính mình**; Stryker/k6 chỉ chạy khi Tech Lead báo "máy rảnh".
4. Commit WIP sớm và thường xuyên trên branch của mình (đã qua hook) — phiên có thể bị đóng bất ngờ khi máy cạn bộ nhớ.
5. **Sau mỗi lần rebase/đổi branch: chạy `pnpm install --frozen-lockfile` ngay** (trước khi commit) — nếu không, hook `pnpm exec …` có thể tự kích hoạt `pnpm install` và treo vì tranh khóa store với phiên khác.
6. **Tắt mọi server/tiến trình bạn tự bật** (`next start`, `tsx src/main.ts`, Playwright webServer, container tạm) khi chạy xong — một server bị quên đã chạy >10 giờ chiếm RAM.
7. Xóa worktree không dùng nữa: `git worktree remove ../TaskFlow_wt/<X>` (bật `core.longpaths`).
6. **Cổng nghiệm thu chạy trên snapshot của chính mình** (branch/commit cố định trong worktree của mình), không bao giờ trỏ vào worktree đang làm việc của người khác — họ có thể đổi branch giữa chừng (bài học T-028, F).
