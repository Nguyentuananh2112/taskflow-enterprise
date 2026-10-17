# T-044 — Khởi động app + bundle — báo cáo Engineer A

Nhánh `feat/T-044-startup-bundle`, rebase lên `main` f191b48 (2026-10-17). Nguồn: ticket `docs/tasks/T-044-startup-bundle.md`,
đề xuất của E `docs/reviews/startup-bundle-proposal.md`.

## Kết luận

- **Mục tiêu thời gian CHƯA đạt** — thẻ đầu board ≈ 0,89 s (mục tiêu ≤ 500 ms), long task lớn nhất ≈ 157 ms (mục tiêu ≤ 100 ms).
  Trên máy dev dùng chung không đo được khác biệt thời gian giữa base / S1 / S2a (mọi chênh lệch < 7 %, nằm trong nhiễu,
  đổi chiều giữa các lượt).
- **Byte giảm thật** (tất định): S1 bỏ `socket.io-client` khỏi JS khởi động ⇒ −12,6 KB gzip / −41 KB decoded ở mọi route.
- **S3 bị bỏ** (revert): không có bằng chứng lợi ≥ 10 % (quy tắc của TL), lượt nhiễu duy nhất cho thấy chậm hơn, và tốn
  thêm +5,3 KB gzip. `apps/web` của nhánh = bản S1 + S2a (giống hệt e0e2f19 trước rebase).
- Chưa làm: S5 (mount lười Popover chuông / Toaster), S2b (gộp `user` vào `/auth/refresh` — đổi contract), S4. TL quyết có
  tiếp tục hay không (xem "Câu hỏi mở").

## Commit (sau rebase lên f191b48)

| Commit | Nội dung |
|---|---|
| `608114f` | ticket + script đo xen kẽ `e2e/perf/startup.mjs` (không vào CI) |
| `df62dac` | **S1** — `socket.io-client` nạp bằng `import()` ở lần nối đầu |
| `04a5aa6` | script kiểm BUILD_ID của từng bản build mỗi lượt (sai bản ⇒ dừng) |
| `5cefee7` | **S2a** — khôi phục phiên (refresh → me) bắt đầu ở render đầu, không chờ cả cây hydrate |
| `c342be6` | script theo review của E: chế độ `bytes`, `jsDecodedKB`, loại lượt nhiễu, 5 vòng mặc định |
| `de69362` | realtime nối lại cả khi `window` `online` (gợi ý của E) |
| `1e53537` | S2a chỉ khởi động từ AuthGate / GuestGate (review của E) |
| `c5fbd5b`, `adde3c6` | S3 + vá refetch board — **đã revert** |
| `08c8c13` | script đo đặt `API_URL` cho server standalone |
| `4454a91` | revert S3 (c5fbd5b + adde3c6) |

## Đo

Phương pháp: `next build` + server standalone, mock API cùng origin, Chromium headless CPU 4×, board 10 task, xen kẽ
A,B,B,A,… 5 vòng mỗi cặp, lượt có CPU nền ≥ 25 % sau lượt bị loại (`noisy`). Bản build ở 4 worktree detached trên ổ C:
base 2755bbd · s1 eab6771 · s2a e0e2f19 · s3 93e509a (trước rebase; main chỉ thêm T-052 — chỉ api — nên bundle web không đổi).

### Byte First Load JS (gzip KB, tất định)

| Route | base | s1 | s2a | s3 |
|---|---|---|---|---|
| `/login` | 348,1 | 335,4 | 335,5 | 340,8 |
| `/w/:ws/projects` | 350,0 | 337,3 | 337,5 | 341,9 |
| board | 407,5 | 394,8 | 394,9 | 396,1 |
| shared | 346,4 | 333,7 | 333,8 | 339,1 |

s2a so với base: −12,6 KB gzip (≈ −3,6 % `/login`, −3,1 % board). Decoded: 1242 → 1201 KB.

### Thời gian thẻ đầu (ms, trung vị lượt sạch, 2 lượt đo gộp)

| Bản | n sạch | trung vị | các lượt sạch |
|---|---|---|---|
| base | 6 | 893 | 929, 839, 852, 916, 854, 893 |
| s1 | 10 | 895 | 902, 953, 841, 887, 857, 869, 828, 895, 907, 982 |
| s2a | 7 | 898 | 1135, 887, 844, 918, 828, 1056, 898 |
| s3 | 0 | — | 3 lượt nhiễu: trung vị 965 |

Long task lớn nhất (trung vị lượt sạch, lượt 2): base 157 · s1 163 ms. Theo cặp (lượt 2, script in): base↔s1 893 / 869;
s1↔s2a 907 / 844.

Điều kiện: lượt 1 (phiên -66, 15:00–15:28) bị ngắt khi worktree chứa `startup.mjs` đổi branch; lượt 2 (15:44–16:14) CPU nền
26–76 % suốt lượt, hết hạn 30 phút ở cặp s2a↔s3 sau 6 lần thử, 0 lượt sạch. **Số thời gian chỉ đủ để nói "không thấy khác
biệt", không đủ để nói "nhanh hơn X ms".**

## Kiểm tra sau rebase + revert (exit code)

`pnpm install --frozen-lockfile` 0 · `typecheck` web 0 · prettier + eslint trên file nhánh đổi 0 · `vitest --project web`
0 (88 file / 637 test) · `vitest --project web-server` 0 (1 / 2). Hook pre-commit (gitleaks / prettier / eslint) xanh.
Verify đầy đủ, `lint:deps`, E2E do TL / F chạy ở lượt merge.

## Rủi ro

- S2a đổi thời điểm khôi phục phiên: cần F chạy lại E2E phiên (nhiều tab, hết hạn, logout pending, E2E-11) + realtime
  `notification:new` ngay sau đăng nhập trước khi merge (đã hẹn với TL). Không cần E2E two-clients / collaboration vì S3 đã bỏ.
- S1: socket nạp động — lần nối đầu chậm thêm một chunk (≈ 13 KB gzip) sau đăng nhập; realtime vẫn nối sau đăng nhập.

## Bài học

Script đo chạy `startup.mjs` từ worktree đang làm việc ⇒ đổi branch ở đó làm hỏng lượt đo đang chạy. Lần sau: copy script
đo ra thư mục cố định (hoặc chạy từ một bản build) trước khi đo.

## Câu hỏi mở (TL)

1. Đóng T-044 với lợi byte (S1 + S2a) và ghi mục tiêu ≤ 500 ms là "không đạt / chưa đo được trên máy chung", hay giữ vé mở
   cho S5 / S2b khi có máy yên (hoặc runner CI riêng)?
2. Sàn ≈ 0,8–0,9 s @4× chủ yếu là chuỗi `refresh → me → query route` (thác pha: refresh ~670 ms, me ~690 ms, board ~750 ms
   trong lượt sạch) — S2b (bỏ một round-trip) là bước duy nhất có khả năng đổi rõ con số; cần B + SEC.
