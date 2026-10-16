# test/sec-unpend: suite bảo mật chạy đủ ca mặc định (Engineer F)

**Branch:** `test/sec-unpend` từ main 68e8e31 · **Ngày:** 2026-10-16 · **Nguồn:** B phát hiện, Tech Lead quyết

## Vấn đề

Job `security suite (SEC)` trong `ci.yml` không đặt `SEC_RUN_PENDING`. Vì vậy mọi ca viết bằng `pendingRoute` đều bị **skip** (theo B là 44 ca, gồm SEC-21c/23b/23c, cookie tossing…), dù route/tính năng đã có trên main. Hệ quả: cổng "suite bảo mật xanh trên CI" đo thiếu.

## Thay đổi (chỉ `apps/api/test/security/**`)

| File | Nội dung |
|---|---|
| `harness/pending.ts` *(mới)* | `DECLARED_PENDING` là danh sách **duy nhất** được phép skip. Mỗi mục: `reason` + `ticket`. Trên main danh sách **rỗng**: mọi nhãn chặn cũ (auth/task/workspace routes, T-020, T-021, T-032, ADR-109) đều trỏ tới tính năng đã có |
| `harness/suite.ts` | `pendingRoute` đổi thành `secCase`. Ca có thân thì **chạy mặc định**; skip chỉ khi id có trong danh sách. `SEC_RUN_PENDING=all\|<id>\|<ticket>` vẫn chạy được ca đã khai báo (dùng nghiệm thu branch làm tính năng). Ca chưa có thân vẫn là `todo` (không bao giờ xanh giả) |
| `harness/skip-budget-reporter.ts` *(mới)* | Reporter Vitest: còn ca bị skip mà **không** khai báo, kể cả `ctx.skip()` động (build từ chối khởi động, probe `BUILD-PROBE` không thấy limiter/gateway), thì in danh sách và đặt `process.exitCode = 1`. Lượt có `-t` chỉ cảnh báo. Vitest không bao giờ tự đặt exit code về 0 |
| `vitest.config.ts` | `reporters: ['default', './test/security/harness/skip-budget-reporter.ts']`. Reporter nạp theo đường dẫn, không import vào config: loader native của Vite sẽ không nhận import thiếu đuôi file |
| `*.sec.ts` | Đổi tên thuần sang `secCase` (77 lời gọi); `valkey-outage` chỉ bỏ dựng container khi cả 3 ca đều được khai báo pending; nhãn skip động `PENDING-ROUTE T-016` đổi thành `BUILD-PROBE T-016` |

`ci.yml` **không cần sửa**: `pnpm --filter @taskflow/api test:security` giờ tự chạy đủ ca và tự đỏ khi có skip lạ.

## Kết quả (snapshot 68e8e31 + adf60b7, DB `taskflow_sec`, Valkey db 15, không đặt `SEC_RUN_PENDING`)

| Kiểm | Kết quả |
|---|---|
| `pnpm --filter @taskflow/api typecheck` · `prettier --check` · `eslint --max-warnings=0` (test/security) | exit 0 · 0 · 0 |
| `test:security` mặc định ×2 (trước/sau khi đổi cách nạp reporter) | **exit 0 ×2: 10 file, 89 passed / 0 skipped / 36 todo**, ~140 s; `[skip-budget] OK — skip 0/0` |
| Reporter, ca âm: file tạm có `it.skip` không khai báo | **exit 1**, liệt kê đúng ca |
| Reporter, cùng file chạy với `-t` | exit 0 + cảnh báo |
| Ca khai báo pending tạm (`SEC-ZZ`/`T-999`) | skip, exit 0, `skip 1/1` |
| Cùng ca đó với `SEC_RUN_PENDING=T-999` | chạy (passed), exit 0 |

File tạm của các lượt kiểm reporter đã xóa; `pending.ts` đã khôi phục về rỗng.

## Rủi ro / ghi chú

- Lượt CI mặc định giờ dài hơn (ca race ×20/×40, valkey-outage dựng container tạm). Local đo ~140 s cho cả suite.
- 36 `todo` (ca chưa viết thân, SEC-35..39/41/21b socket auth, ca ngoài tầng…) không bị reporter tính. Viết thân thì ca tự chạy.
- Thêm pending mới bắt buộc qua `pending.ts` (review thấy được). Tính năng merge thì xóa mục trong cùng PR.
