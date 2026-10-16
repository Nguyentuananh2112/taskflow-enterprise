# BACKLOG — hàng đợi việc kế tiếp theo vai trò (không ai phải ngồi chờ)

**Quy tắc (ADR-112):** khi bạn nhắn `DONE …` cho Tech Lead, **đừng chờ review** — lấy ngay mục **đầu tiên chưa ai nhận** trong hàng của vai trò mình, ghi tên mình + ngày giờ vào cột "Đang làm", commit dòng đó cùng branch đầu tiên của việc mới. Tech Lead vẫn review/merge việc cũ song song; nếu review trả về sửa, ưu tiên sửa trước rồi quay lại. Hết hàng của mình ⇒ lấy hàng **Chung**. Việc cần quyết định lớn ⇒ hỏi Tech Lead, trong lúc chờ làm phần không phụ thuộc.

Mỗi việc vẫn theo `docs/TEAM.md`: worktree/branch riêng (dùng lại worktree — ADR-107), hook không bỏ qua, DoD kiểm **exit code**, `pnpm` chạy đủ các bước CI chạy được local, báo cáo trong `docs/reviews/`.

## A — Platform/Backend (`taskflow-enterprise-50`)
| # | Việc | Ghi chú | Đang làm |
|---|---|---|---|
| A1 | T-036 tài liệu repo công khai | đang giao | A |
| A2 | OpenAPI 3.1 sinh từ Zod contracts (không viết tay), phục vụ ở `/api/docs` CHỈ khi APP_ENV ∈ {local,test}; CI kiểm spec sinh ra khớp route thật (mọi route trong router có trong spec và ngược lại) | tài liệu cho người dùng API của repo public | A — 2026-10-15 (feat/A2-openapi) |
| A3 | Tối ưu theo kết quả k6 (T-027 của D): index/truy vấn board, pool DB — chỉ làm khi có số đo | chờ T-027 | A — 2026-10-16 (feat/A3-batch-rebalance) |

## B — Security/Backend (`taskflow-enterprise-87`)
| # | Việc | Ghi chú | Đang làm |
|---|---|---|---|
| B1 | Runbook go-live §6.3 + review trước merge T-034, fix bàn phím | đang giao | B |
| B2 | Sao lưu + khôi phục: script `pg_dump` mã hóa phía client (age/gpg — chọn 1, lý do), đẩy ra storage ngoài nhà cung cấp (giao diện S3 tương thích, cấu hình qua env), **diễn tập khôi phục tự động** trên Postgres tạm (dump → restore → đối chiếu số dòng/kiểm tra toàn vẹn) chạy được trong CI hằng tuần; runbook | ADR-074, devops.md §4 | B (2026-10-15) |
| B3 | Threat model cuối (STRIDE) cho v1 sau mọi fix — cập nhật security.md, liệt kê rủi ro chấp nhận có chủ đích kèm ADR | | B (2026-10-15) |

## D — QA/DevOps (`taskflow-enterprise-a5`)
| # | Việc | Ghi chú | Đang làm |
|---|---|---|---|
| D1 | `pnpm verify` gom mọi bước CI chạy được local (lint, typecheck, test, check-env-example, migrate diff khi có DB) | đã đề xuất |D — 2026-10-15 (branch chore/verify-script) |
| D2 | T-027 đo k6 | khi Tech Lead báo "máy rảnh" | |
| D3 | Chuẩn bị deploy KHÔNG tốn tiền cho cả 2 phương án (ADR-070): (a) DigitalOcean App Platform `app.yaml` + Managed PG/Valkey, (b) 1 VPS + Docker Compose + Caddy (HTTPS tự động); workflow deploy staging/prod (environment protection, migrate job trước rollout, smoke sau deploy, rollback); KHÔNG tạo tài khoản/tài nguyên thật | để người dùng chốt hosting xong là chạy được | D — 2026-10-15 (branch feat/D3-deploy-prep) |

## E — Frontend (`taskflow-enterprise-54`)
| # | Việc | Ghi chú | Đang làm |
|---|---|---|---|
| E1 | Rebase T-034 + F5/F2/F1/F3/F4 | đang giao | E |
| E2 | Fix kéo bàn phím vào cột trống (WCAG 2.1.1) | cổng E2E-03 của F | E — 2026-10-15 21:35, `fix/dnd-keyboard-empty-column` |
| E3 | Rà responsive (360px → 1440px) cho mọi màn, dark mode, trạng thái loading/empty/error theo frontend.md §1; sửa chỗ lệch | F viết E2E viewport mobile song song | E — 2026-10-15 22:30, `feat/E3-ui-polish` (gồm G1 W1 của A) |
| E4 | Rà chuỗi tiếng Việt toàn app (nhất quán thuật ngữ, không lộ mã lỗi kỹ thuật cho người dùng) | | E — 2026-10-15 23:25, `feat/E4-vi-strings` (rà tĩnh xong, không cần sửa) |
| E5 | Board 1440px: header căn giữa còn board căn trái ⇒ khung ngang chung cho header + mọi màn (360/768/1440 × sáng/tối); đóng G2 F2–F4 | Tech Lead giao 2026-10-16 | E — 2026-10-16, `feat/E-layout-g2` |

## F — QA độc lập (`taskflow-enterprise-bf`)
| # | Việc | Ghi chú | Đang làm |
|---|---|---|---|
| F1 | T-026 E2E toàn bộ + cổng T-034, fix bàn phím | đang giao | F |
| F2 | E2E viewport mobile + Firefox cho luồng chính; săn test chập chờn (chạy lặp 20× bộ E2E, liệt kê flake + nguyên nhân) | | |
| F3 | Chạy mutation hằng tuần (Stryker) lên toàn bộ module auth/workspace/task hiện tại khi Tech Lead báo "máy rảnh"; findings theo chủ module | | F — 2026-10-16 (feat/F3) |
| F4 | Viết thân 36 ca SEC todo trong `apps/api/test/security` (danh sách `TODO_BUDGET` ở `harness/pending.ts`: socket auth SEC-21b/35–39/41, rate limit SEC-28/28b/GATE-T016-401, auth SEC-17/19/20/22–24/24d/26/27/32, tenant SEC-13–16/46/47/51–55, task SEC-09; SEC-48–50 thuộc E2E — chỉ đối chiếu) — viết xong ca nào xóa mục đó cùng PR | nợ ma trận SEC (review B của sec-unpend) | |
| F5 | Kiểm 503 fail-closed khi Valkey chậm (SEC-34 đỏ 1 lần lúc máy tải nặng, chạy lại xanh): hành vi đúng (ADR-108/074) hay timeout Valkey của harness quá chặt — harness ⇒ nới; sản phẩm ⇒ báo B | TL duyệt 2026-10-16 | |

## Chung (ai hết hàng thì lấy)
| # | Việc | Đang làm |
|---|---|---|
| G1 | Đọc chéo một module KHÔNG phải của mình, tìm lỗi (bảo mật, đồng thời, xử lý lỗi), gửi findings cho chủ module + Tech Lead | A — web (session, realtime, lỗi) — 2026-10-15 · B — T-033 (C): scheduler bảo trì + rebalance rank — 2026-10-15 · B — D3 (D): bảo mật deploy — 2026-10-15 (`review/G1-D3-security`) · D — auth (A): phiên/refresh token, đồng thời, xử lý lỗi — 2026-10-16 (`review/G1-auth`) · E — workspace API ↔ web (mã lỗi, realtime, 409) — 2026-10-16 (`review/G1-workspace-fe`) |
| G2 | Rà `docs/design/*` đối chiếu code hiện tại: chỗ nào tài liệu lệch thực tế ⇒ báo chủ tài liệu | E (frontend.md, test-spec-*) — 2026-10-15 23:30, `review/G2-design-drift` · A (data-and-api, security, devops) |
