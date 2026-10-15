# T-026 — E2E Playwright: báo cáo (Engineer F)

**Branch:** `feat/T-026` (worktree `D:\TaskFlow_wt\T-017b`, ADR-107) · **Ngày:** 2026-10-15 · **Người làm:** Engineer F (QA)

## 1. Khung

| Thành phần | Nội dung |
|---|---|
| Package | `e2e/` (thêm vào `pnpm-workspace.yaml`); catalog `@playwright/test` **1.64.0** (1.64.1 phát hành < 24h ⇒ bị `minimumReleaseAge` chặn), `@axe-core/playwright` 4.13.0 (TL duyệt). Lockfile: chỉ thêm entry importer `e2e` + hậu tố peer `(@playwright/test@1.64.0)` cho `next`/`@sentry/nextjs` (next có optional peer Playwright) — không đổi phiên bản package nào. |
| API | process thật `node --import tsx src/main.ts`, Prisma + Valkey db 14, cổng 4100, `JWT_ACCESS_TTL_SECONDS=10` (E2E-11; chỉ nhận khi `APP_ENV=test`). |
| Web | **build production** chạy như image (`apps/web/Dockerfile`): output standalone + copy static/public ⇒ `node apps/web/server.js` (`e2e/support/start-web.mjs`), cổng 3100, `APP_ENV=test`, KHÔNG đặt `APP_MOCK_API` (request đi API thật — `registerViaUi` khẳng định 201 từ `API_URL`). |
| DB | `taskflow_e2e` (ADR-106) qua `prepareSuiteDatabase` của suite bảo mật (khóa advisory theo DB + Valkey, giữ tới teardown). |
| Seed | chỉ qua API công khai (`e2e/support/api.ts`); xóa bộ đếm rate limit Valkey db 14 trước mỗi test (mọi user cùng IP). |
| An toàn | fixture `noCspViolations` **tự động cho mọi test**: còn `securitypolicyviolation` ⇒ test đỏ (cả context phụ qua `openAs`). |
| Chạy | local: `workers: 1`, Chromium (headless shell); `E2E_FIREFOX=1` / `E2E_MOBILE=1` (Pixel 7) chạy luồng `@main`; CI: song song + đủ trình duyệt. Trace/video chỉ giữ khi fail. Không `waitForTimeout` cố định. |

Chạy: `pnpm --filter @taskflow/web build` rồi `cd e2e && pnpm exec playwright test`.

## 2. Kịch bản

| ID | Nội dung | Trạng thái |
|---|---|---|
| — | Đăng ký UI ⇒ /w; reload giữ phiên | ✅ |
| E2E-01 | Đăng ký → workspace → project mặc định → tạo task cuối cột | ✅ |
| E2E-02 | Kéo chuột Cần làm → Đang làm; reload giữ cột | ✅ |
| E2E-03 | Kéo **bàn phím** vào cột TRỐNG | fixme có nhãn — chờ fix E2 của E (đã có bản; cổng của F bắt hồi quy 2 lần, xem §4) |
| E2E-03b | Bàn phím vào cột đã có thẻ | ✅ |
| E2E-04 | Cần làm → Hoàn thành bị chặn, không PATCH (có đối chứng giữa lúc kéo) | ✅ |
| — | Menu "Chuyển tới…" (đường thay thế không kéo) | ✅ |
| E2E-05 | Realtime 2 người < 2s; workspace khác không nhận frame | ✅ |
| E2E-06 | Xung đột: B sửa dở ⇒ 409 + khối hòa giải "Giữ bản của tôi"; A chỉ kéo ⇒ B lưu mô tả tự rebase | ✅ |
| E2E-07 | VIEWER: không tạo, không tay kéo/menu, drawer chỉ đọc | ✅ |
| E2E-08 | Lưu trữ project ⇒ tab người khác chuyển chỉ đọc (qua API và qua UI T-034) | ✅ |
| E2E-09 | Xóa B khỏi workspace ⇒ B về /w + toast | ✅ |
| E2E-10 | Đăng xuất mọi thiết bị ⇒ context khác về /login | ✅ |
| E2E-11 | Access token hết hạn (10s) ⇒ sửa hồ sơ vẫn thành công, có refresh 200 (thuần SPA) | ✅ |
| E2E-12 | axe serious/critical — login, register, /w, /account, **board, drawer, thành viên** (sáng + tối) | ✅ (12b: viết xong, chờ lượt máy chạy) |
| E2E-13 | Offline ⇒ online tự refetch | ✅ |
| E2E-14 | Xóa workspace khi B mở board ⇒ B về /w; khôi phục ⇒ vào lại (API + UI khu "Đã xóa") | ✅ |
| E2E-15 | Hạ B xuống VIEWER ⇒ mất tay kéo, task "Chưa giao" | ✅ |
| E2E-16 | Cùng image, API_URL khác | fixme — thuộc CI |
| E2E-REBAL | Chèn lặp ⇒ rebalance (rank 64) ⇒ thứ tự A/B đúng (realtime + sau reload); không còn rank `~`; tạo task sau đó 201 | ✅ |
| T-033 `~id` | Chuỗi chính xác của B (N=372 lần L, rồi X) ⇒ X không kẹt `~<uuid>`, tạo task 201 | ✅ (đỏ trên main trước fix của A) |
| T-034 ×6 | Thêm thành viên (+ email lạ), hạ Người xem ⇒ bỏ giao, LAST_OWNER, xóa/tự rời, xóa ws gõ slug ⇒ khôi phục, archive UI | ✅ |
| SEC-48 / 48b / 50 | 0 vi phạm CSP (cả lúc kéo trên board); token không trong storage; cookie HttpOnly + Strict | ✅ |
| T-035 | Sentry web 2 chế độ (có/không DSN): SDK nạp động không vi phạm CSP, lỗi ⇒ `/monitoring` same-origin, không request ra ngoài, không `sentry-trace` tới API | ✅ (cổng; DSN `.invalid`) |

**Lượt đầy đủ gần nhất** (snapshot 148de04 + feat/T-026): **exit 0 — 32 pass / 0 fail / 3 fixme**, 3.0 phút, 1 worker. F2: luồng `@main` 18/18 trên chromium + firefox + mobile.

## 3. Lỗi sản phẩm E2E bắt được (đều trên build production, hộp đen)

| Mức | Lỗi | Chủ | Trạng thái |
|---|---|---|---|
| **HIGH** | dnd-kit chèn `<style>` không nonce ⇒ CSP prod chặn ⇒ kéo thả (chuột + bàn phím) **không thả được** ở production. Đối chứng `bypassCSP` ⇒ xanh | E | Đã sửa (f2b735c, `StyleInjector` nonce) — cổng F xanh |
| Low | Zod 4 dò `Function("")` ⇒ vi phạm CSP mọi trang (SEC-48) | E | Đã sửa (jitless) |
| Medium | API không phát `project:updated` ⇒ board người khác không khóa khi lưu trữ (mock của web có phát ⇒ T-025 xanh giả) | B | Đã sửa (87ed150); TL duyệt contract test parity event |
| Medium (a11y) | Bàn phím không thả vào cột trống | E | Đang sửa — 7d476f5 hỏng kéo chuột (E2E-02 đỏ 3/3, đối chứng main xanh); 85db884 làm E2E-04 thả vào cột bị chặn lại **lưu move sang cột trung gian** (đỏ 5/5) — cả hai bị cổng chặn |
| HIGH | Rank kẹt `~<id>` sau rebalance cùng cột ⇒ tạo task 500 (B tìm; F viết cổng đỏ trên main) | A | Đã sửa (1681b20) — cổng F xanh 3/3 hợp lệ |

## 4. Quyết định tự đưa ra / rủi ro

- DSN Sentry trong cổng là `https://public@sentry.invalid/1` (`.invalid` không phân giải ⇒ không gì ra Internet).
- E2E-REBAL / rank-tilde cần vài trăm move/phút > hạn mức `api-user` 300/phút (đúng thiết kế) ⇒ gặp 429 thì xóa Valkey db riêng của E2E rồi thử lại — chỉ để dựng dữ liệu, không kiểm rate limit.
- Helper kéo: thả vào phần cột NHÌN THẤY (viewport hẹp); chờ cột nhận làm đích (`ring-2`) trước khi thả — không thả "mù".
- Máy dev quá tải: webServer timeout 300s; một số lượt bị loại vì hạ tầng (ghi rõ, không tính).

## 5. Việc còn lại

1. E2E-03: bỏ `fixme` khi fix E2 của E qua cổng (E2E-02/03/03b/04 + SEC-48b ×3 + bộ đầy đủ).
2. E2E-12b: chạy (đã viết).
3. E2E-16: job CI (2 lần khởi động container cùng image).
