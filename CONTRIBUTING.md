# Đóng góp cho TaskFlow

Cảm ơn bạn! Tài liệu này là quy trình làm việc của đội (chi tiết vai trò: [docs/TEAM.md](docs/TEAM.md)). Báo lỗ hổng bảo mật: **không** qua issue/PR — xem [SECURITY.md](SECURITY.md).

## Đóng góp từ bên ngoài (fork → pull request)

1. Fork repo, tạo branch từ `main` (`fix/<mô-tả>`, `feat/<mô-tả>`, `docs/<mô-tả>`).
2. Chuẩn bị máy theo mục 1 dưới đây, sửa code kèm test.
3. Trước khi mở PR: `pnpm install --frozen-lockfile` rồi **`pnpm verify`** phải exit 0 (mục 4).
4. Mở pull request vào `main`, mô tả vấn đề + cách sửa + cách kiểm. CI phải xanh; người duy trì review rồi merge.
5. **Không** đưa secret, `.env`, dữ liệu thật vào commit (hook gitleaks chặn — mục 3). **Lỗ hổng bảo mật: không mở issue/PR công khai** — theo [SECURITY.md](SECURITY.md).

Các mục 1, 3, 4, 5 áp dụng cho mọi người; mục 2, 6 và 7 là quy trình nội bộ của đội phát triển.

## 1. Chuẩn bị

Làm theo [docs/runbook/local-dev.md](docs/runbook/local-dev.md) (Node 24, pnpm 11.28.2 qua corepack, Docker, **gitleaks**). `pnpm install` cài luôn git hook (lefthook).

## 2. Quy trình nội bộ của đội: branch và worktree

- Mỗi việc một branch từ `main`: `feat/<TICKET>` (tính năng), `fix/<mô-tả>` (sửa lỗi), `docs/<mô-tả>`.
- Làm trong **git worktree** riêng để không đụng thư mục chính và việc của người khác:

  ```sh
  git worktree add ../TaskFlow_wt/<TICKET> -b feat/<TICKET> main
  ```

- **Dùng lại worktree** cho việc tiếp theo thay vì tạo mới (ADR-107 — `pnpm install` trong worktree mới mất hàng chục phút trên Windows): commit hết việc cũ rồi `git switch -c feat/<TICKET-mới> main`.
- Chỉ sửa file trong phạm vi việc của mình; cần đụng file của người khác ⇒ báo trước, ghi vào báo cáo.
- Không merge vào `main`, không push trực tiếp — Tech Lead review và merge.
- Commit thường xuyên (cả WIP) để không mất việc khi máy chậm/treo.

## 3. Git hook pre-commit — không bỏ qua

`lefthook.yml` chạy song song trên file staged:

| Hook       | Mục đích                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `gitleaks` | Chặn secret lọt vào lịch sử (repo public — ADR-072). Thiếu binary gitleaks ⇒ **không commit được** |
| `prettier` | Định dạng, tự `git add` lại                                                                        |
| `eslint`   | Lint, `--max-warnings=0`                                                                           |

**Cấm `git commit --no-verify`.** Hook đỏ ⇒ sửa nguyên nhân. Không bao giờ commit `.env`, khóa, dữ liệu thật — kể cả "tạm". CI chạy lại gitleaks trên toàn lịch sử.

## 4. Definition of Done

Trước khi báo xong (và sau khi rebase lần cuối lên `main`):

```sh
pnpm install --frozen-lockfile   # luôn chạy sau pull/rebase — xem ghi chú dưới
pnpm verify                      # lint (gồm .env.example ↔ env.ts) · typecheck · test · audit — in bảng exit code
```

- Thêm `VERIFY_DB_URL=<DB riêng của bạn trên postgres-test, user migrator>` ⇒ `pnpm verify` chạy thêm `prisma validate` + migrate + grant + kiểm drift trên DB đó.
- `pnpm verify` chạy hết các bước rồi mới tổng kết; exit ≠ 0 nếu có bước đỏ. Từng bước lẻ vẫn chạy được: `pnpm lint` (tự `prisma generate` trước — worktree mới không đỏ oan), `pnpm typecheck`, `pnpm test`.
- **`pnpm` không tự cài dependency** (`verifyDepsBeforeRun: error`): node_modules lệch lockfile ⇒ lệnh dừng với `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN … Run "pnpm install"`. Chạy `pnpm install --frozen-lockfile` rồi chạy lại. Git hook gọi thẳng `node_modules/.bin/*` nên không bị chặn.
- **Kiểm EXIT CODE**, không chỉ đọc chữ "passed": worker Vitest chết hoặc lỗi ngoài test vẫn có thể in "passed" nhưng exit ≠ 0.
- Đụng persistence / SQL / race ⇒ chạy thêm `pnpm --filter @taskflow/api test:integration` trên **database riêng của bạn** (postgres-test dùng chung, harness xóa schema `public` — ADR-106, runbook §5).
- Luật nghiệp vụ / bảo mật mới ⇒ có test; sửa lỗi ⇒ có test tái hiện lỗi. Tốt hơn nữa: chứng minh test bắt được lỗi (đổi code cho sai ⇒ test đỏ).
- Viết báo cáo `docs/reviews/<TICKET>-report.md`: đã làm gì, file nào, quyết định tự đưa ra, rủi ro, kết quả DoD.

## 5. Quy ước code

- Luật kiến trúc do máy ép ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §2, ADR-004): domain thuần, use case chỉ biết port, module chỉ dùng nhau qua `index.ts`, FSD chỉ phụ thuộc xuống. Thêm luật ⇒ thêm fixture vi phạm + test trong `packages/config/test`.
- Schema / type / mã lỗi dùng chung FE-BE đặt ở `packages/contracts` — không định nghĩa lại ở app.
- Phiên bản thư viện chốt một nơi: `catalog:` trong `pnpm-workspace.yaml`, pin chính xác. pnpm không cài bản phát hành < 24 giờ (`minimumReleaseAge`); gói có install script phải được duyệt vào `allowBuilds`.
- Prisma: luôn `pnpm exec prisma` / script `db:*`, **không** `npx prisma` (ADR-061). App chạy bằng user DB chỉ có quyền DML; migrate bằng user migrator.
- Log: không ghi PII/secret; lỗi đi qua serializer allow-list (`core/logging/error-serializer.ts`).

## 6. Quy trình nội bộ: giảm tải máy dev (ADR-107)

Nhiều người/phiên làm song song trên cùng máy:

- Vitest dùng mặc định của repo (4 worker) hoặc `VITEST_MAX_WORKERS=2` khi máy bận — chỉ cho unit; `test:integration` luôn tuần tự.
- Không chạy song song việc nặng (Stryker, k6, build Docker, `next build`) — xếp hàng.
- Xóa worktree không còn dùng: `git worktree remove ../TaskFlow_wt/<X>`.
- Tiến trình bạn tự khởi động (server smoke test, …) — tự tắt khi xong.

## 7. Quy trình nội bộ: quyết định kiến trúc (ADR)

- Mọi quyết định có hệ quả lâu dài (thư viện, giao thức, luật bảo mật, đánh đổi) được ghi thành một dòng trong [docs/blueprint/DECISIONS.md](docs/blueprint/DECISIONS.md): `ADR-<số> ✅ <quyết định> — lý do, hệ quả, link tài liệu`.
- Chỉ Tech Lead sửa DECISIONS: đề xuất ADR mới bằng cách nêu vấn đề, các phương án, đánh đổi, khuyến nghị (trong báo cáo hoặc tin nhắn); Tech Lead chốt số ADR và ghi.
- Không chép lại nội dung ADR ở chỗ khác — tham chiếu số ADR.
