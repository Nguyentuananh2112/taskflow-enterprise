# TEAM — Quy trình phòng IT TaskFlow

## Vai trò
| Session | Vai trò | Ghi chú |
|---|---|---|
| `taskflow-enterprise-0b` | **Tech Lead / Kiến trúc sư** | Ra quyết định, viết ticket, review, merge. Không ai khác sửa `docs/blueprint/DECISIONS.md`. |
| `taskflow-enterprise-50` | **Engineer A — Platform/Research** | Hạ tầng, tooling, nghiên cứu công nghệ, sau này: Auth. |
| `taskflow-enterprise-87` | **Engineer B — Security/Backend** | Thiết kế bảo mật, sau này: Workspace/Project/RBAC. |
| `taskflow-enterprise-ba` | **Engineer C — Domain/Contracts** | Data model, API contract, sau này: Task domain. |
| `taskflow-enterprise-a5` | **Engineer D — QA/DevOps** | Vận hành production, CI/CD, chiến lược test; sau này: test độc lập (bảo mật/IDOR/E2E), pipeline. |
| `taskflow-enterprise-b7` | **Engineer E — Frontend** | Kiến trúc FE & UX; sau này: Kanban board, realtime phía client. |

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
5. Xong việc: viết báo cáo vào `docs/reviews/<TICKET>-report.md` (đã làm gì, file nào, quyết định tự đưa ra, rủi ro, câu hỏi mở), rồi **SendMessage cho `taskflow-enterprise-0b`** dòng đầu: `DONE <TICKET>`.

## Definition of Done (từ Phase 1 trở đi)
`pnpm typecheck && pnpm lint && pnpm test` xanh · không vi phạm ADR-004 · test cho mọi luật nghiệp vụ mới · báo cáo đã gửi.

## Lộ trình
| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Chốt thiết kế: T-001 stack · T-002 bảo mật · T-003 data + API · T-004 DevOps/QA · T-005 Frontend/UX | 🟢 Đang chạy |
| 1 | Nền móng monorepo, Docker, Prisma, core, contracts, lint/CI (1 người, tuần tự) | ⏳ |
| 2 | Backend song song: Auth · Workspace/Project/RBAC · Task domain | ⏳ |
| 3 | Tích hợp: Prisma repos, routes, audit trong transaction, Socket gateway, test IDOR | ⏳ |
| 4 | Frontend song song: shell + auth · Kanban board | ⏳ |
| 5 | E2E, k6, security review, deploy | ⏳ |
