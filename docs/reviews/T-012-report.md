# T-012 — Báo cáo: nền apps/web (token, shared/ui, fetch wrapper, runtime config, CSP)

**Người làm:** Engineer E (phiên thay thế `taskflow-enterprise-37`, tiếp từ snapshot `b079029` của phiên crash) · **Branch:** `feat/T-012` (đã rebase lên `main` @ `c266a88`) · **Ngày:** 2026-10-15

## 1. Review lại snapshot b079029
Tôi đọc lại toàn bộ 71 file của snapshot, đối chiếu với frontend.md §2/§3.3/§3.6/§6, security.md §6.8 và DECISIONS. Code đúng thiết kế, không có lỗi chặn. Tôi sửa / bổ sung các điểm sau:

| # | Vấn đề trong snapshot | Đã xử lý |
|---|---|---|
| 1 | `dev`/`start` chạy cổng 3000 | Đổi sang **3001** (ADR-097) |
| 2 | Thiếu smoke test "đổi `data-theme` thì `bg-surface` đổi màu", frontend.md §6.1/V4 bắt buộc | Thêm `src/app/styles/theme.test.ts`: biên dịch `globals.css` thật bằng `@tailwindcss/postcss`, kiểm utility đọc biến ngữ nghĩa, kiểm bảng tối, và kiểm bảng tối ở media query giống hệt bảng ở `data-theme` |
| 3 | Race refresh: request A nhận `TOKEN_EXPIRED` **sau khi** request B đã refresh xong thì gọi refresh lần nữa (lãng phí, có thể làm xoay token thêm một vòng) | `http.ts`: nếu token hiện tại khác token đã gửi thì gửi lại luôn, không refresh. Có test |
| 4 | Không có favicon ⇒ 404 trong console (Lighthouse best-practices 92) | Thêm `app/icon.svg` theo quy ước file của Next |
| 5 | Không có mẫu env cho web | Thêm `apps/web/.env.example` (`API_URL`, `WS_URL`, `APP_ENV`, không có `NEXT_PUBLIC_*`) |
| 6 | Xung đột `pnpm-lock.yaml` khi rebase | Lấy lockfile của main rồi chạy `pnpm install` để sinh lại |

Tôi gộp snapshot và các sửa trên thành **một commit** `feat(T-012)` (Tech Lead đã cho phép squash).

## 2. Đã làm (theo mục của ticket)
1. **Cây FSD** (§2.1): route mỏng ở `app/` (gốc), các layer ở `src/{app,views,widgets,features,entities,shared}`. Layer chưa có slice giữ bằng `.gitkeep`. Slice nào cũng có `index.ts`; `shared/ui` mỗi component một thư mục + index riêng, không có barrel chung. `test/structure.test.ts` chặn việc tạo `pages/` và `src/pages/`.
2. **Token + Tailwind 4** (§6.1): biến ngữ nghĩa sáng/tối + `@theme inline`, thang chữ 12–24 với line-height ≥ 1.5, bo góc, bóng. `<html lang="vi">`. Font Inter tự host (xem QĐ-1).
3. **shared/ui**: Button (4 biến thể, loading, asChild), Input, Select, Badge, Avatar, Dialog, Drawer, Toast/Toaster, Skeleton, EmptyState, Spinner. Mọi file ≤ 150 dòng (ESLint ép). Mỗi component có test render + axe-core (tắt `color-contrast` vì jsdom không có layout; tương phản được đo bằng Lighthouse ở dưới). Headless: `radix-ui` 1.8.1.
4. **shared/api**: `createHttpClient` + instance `http`. Base URL lấy từ runtime config; parse envelope (file tạm `envelope.ts` đã được duyệt); `ApiError {status, code, message, details, requestId}` + `isApiError(err, code)`; mã client `NETWORK_ERROR`/`BAD_RESPONSE`; `X-Client-Id` cho request ghi; `credentials: 'include'` chỉ cho `/auth/*`; `data` bắt buộc parse bằng schema. Hook auth `setAuthHooks` (Phase 4 nối): gắn Bearer, single-flight refresh, request mới xếp hàng chờ refresh, `TOKEN_EXPIRED` chỉ thử lại 1 lần, `UNAUTHORIZED` có token ⇒ `onSessionEnded('revoked')`. 21 unit test.
5. **Runtime config** (§3.6): `src/app/config/server-env.ts` parse `API_URL`/`WS_URL`/`APP_ENV` bằng Zod lúc chạy, sai thì throw. Root layout truyền **chỉ** `{apiUrl, wsUrl, appEnv}` xuống `RuntimeConfigBoot`. Store dùng `z.strictObject` nên khóa lạ bị từ chối. `getRuntimeConfig()` gọi trước khi boot thì throw. Có test khẳng định secret không lọt xuống client. **Kiểm thực tế:** `next build` chạy được khi **không** có `API_URL` (mọi route `ƒ Dynamic`), `API_URL` chỉ được đọc ở `next start`.
6. **CSP nonce** (`proxy.ts` + `src/app/security/csp.ts`): nonce 16 byte `crypto.getRandomValues` → base64; policy W-CSP-2; dev nới theo W-CSP-3; header W-CSP-4, HSTS chỉ ở prod. Cơ chế làm theo https://nextjs.org/docs/app/guides/content-security-policy (đặt `x-nonce` + CSP lên request headers). Nguồn cho việc Next 16 đổi `middleware` → `proxy`: stack-versions §3. Zod dùng locale `vi` (`z.config(vi())`, ADR-081).
7. **Trang `/` và `/login`** placeholder dùng Badge/Button/Input/Dialog/Toast.

## 3. Kiểm chứng trên build production (`next start`, cổng 3001)
- Header `/login`: CSP đủ directive W-CSP-2 với `connect-src 'self' http://localhost:4000 ws://localhost:4000`, cùng `nosniff`, `Referrer-Policy`, `Permissions-Policy` và HSTS. `/api/healthz` không bị proxy chạm tới.
- HTML: 13/13 thẻ `<script>` có nonce; stylesheet có nonce; **không có thuộc tính `style="…"`** nào trong HTML do server render (rủi ro mở ở §10 frontend.md: đã đo, không phải nới CSP).
- Chrome thật (listener `securitypolicyviolation`): mở Dialog (Radix chèn `<style>` khóa cuộn, có nonce nhờ `setNonce`), gửi form, hiện Toast ⇒ **0 vi phạm**. Cả hai subset font Inter (latin, vietnamese) đều tải được. Theme tối theo OS hoạt động.
- **Lighthouse 13.5.0** (Chrome headless, desktop mặc định):

| Trang | Accessibility | Best practices |
|---|---|---|
| `/` | **100** | 96 |
| `/login` | **100** | 96 |

  Best practices còn trừ điểm ở mục `inspector-issues` loại "Content security policy" nhưng không có URL nào. Tôi thử bằng listener trên Chrome thật thì không thấy vi phạm nào. Tôi đoán đây là script đánh giá do Lighthouse tự chèn bị CSP nghiêm ngặt chặn. Chưa xác minh tới cùng.

## 4. Quyết định tự đưa ra (cần Tech Lead duyệt)
- **QĐ-1 Font tự host** thay `next/font/google`: file woff2 lấy từ `@fontsource-variable/inter@5.3.0` (phiên trước ghi đã đối chiếu sha512 với registry), giấy phép OFL kèm theo, chỉ có subset latin + vietnamese. Lý do: `next/font/google` bị timeout lúc build; tự host thì build Docker/CI không cần mạng ra Google. Hệ quả: không có preload tự động và không có fallback `size-adjust` như next/font. Có thể chuyển sang `next/font/local` sau nếu đo thấy CLS.
- **QĐ-2 Không dùng `sonner`; Toast dựng trên Radix Toast + store tự viết** (`toast-store.ts`, `useSyncExternalStore`). Lý do đã kiểm trong `sonner@2.0.8/dist/index.mjs`: hàm `__insertCSS` tạo `<style>` và append vào `<head>`, **không có cách truyền nonce** ⇒ CSP `style-src 'nonce-…'` sẽ chặn. Gói `sonner` không có trong `package.json`.
- **QĐ-3 `get-nonce` 1.0.1** là dependency trực tiếp: Radix (react-remove-scroll → react-style-singleton) lấy nonce từ module này. `AppProviders` gọi `setNonce(nonce)`. Lockfile chỉ có một bản `get-nonce`, nên hai bên dùng chung một instance.
- **QĐ-4 Theme**: CSS mặc định theo `prefers-color-scheme`; `data-theme` trên `<html>` ghi đè. **Chưa có** script chọn theme chạy trước khi paint (§6.1) — để Phase 4 làm cùng bộ chọn Sáng/Tối/Hệ thống. Không dùng variant `dark:`.
- **QĐ-5 Select** dùng `<select>` gốc (a11y và mobile do trình duyệt lo). Combobox tìm kiếm làm ở Phase 4.
- **QĐ-6 Màu**: `--warning` sáng `#8a5200` và các màu priority/`text-muted` tối lệch nhẹ so với bảng §6.1 để đạt AA 4.5:1. Avatar dùng bảng 8 màu cố định qua class (không dùng `style=`), có test tương phản.
- **QĐ-7** `X-Client-Id` chỉ gửi cho request ghi (đúng chữ "mọi request ghi" ở §3.3). `GET` không gửi.

## 5. Rủi ro / câu hỏi mở
1. **`upgrade-insecure-requests` + HSTS khi chạy prod trên http://localhost** (`next start`, Docker E2E của D): Chrome hiện bỏ qua cả hai cho localhost nên trang vẫn chạy (Lighthouse đo được). Nhưng nếu E2E chạy với host khác `localhost` qua http (vd tên service Docker `http://web:3001`), CSS/JS sẽ bị nâng lên https và gãy. Đề xuất: bật hai thứ này theo `APP_ENV ∈ {staging, production}` thay vì theo `NODE_ENV`. Việc này đổi W-CSP-2/4 nên cần Tech Lead/B quyết; tôi **chưa** đổi.
2. **Envelope tạm** `shared/api/envelope.ts` (đã duyệt): T-010 chưa merge nên vẫn còn file tạm. Cần follow-up thay bằng import từ `@taskflow/contracts` (cả enum `ErrorCode` cho `isApiError`).
3. `pnpm test` toàn repo có một lần bị lỗi "Timeout waiting for worker to respond" khi máy đang tải nặng. Chạy lại thì xanh. Nếu CI gặp lại, nên đặt `maxWorkers` trong `vitest.config.ts` gốc (ngoài phạm vi của tôi).
4. Proxy chạy cho cả request prefetch của router (docs Next gợi ý có thể loại trừ bằng `missing`). Không sai, chỉ tốn thêm công sinh nonce. Để Phase 4 đo rồi quyết.

## 6. File (tất cả nằm trong `apps/web/**` + báo cáo này)
`app/{layout.tsx,page.tsx,icon.svg,(auth)/login/page.tsx}` · `proxy.ts` · `package.json` · `tsconfig.json` · `vitest.config.ts` · `.env.example` · `src/app/{config,fonts,providers,security,styles}/**` · `src/shared/{api,config,lib,ui}/**` · `src/views/{home,login}/**` · `test/{a11y.ts,structure.test.ts}` · `pnpm-lock.yaml`.

## 7. Definition of Done (chạy trong worktree sau khi rebase lên main `c266a88`)
```
$ pnpm typecheck   → exit 0 (config, contracts, api, web: next typegen && tsc --noEmit)
$ pnpm lint        → exit 0 (prettier, eslint --max-warnings=0; depcruise web: 78 modules, 123 deps, 0 vi phạm)
$ pnpm test        → Test Files 27 passed (27) · Tests 246 passed (246) · exit 0
$ pnpm --filter @taskflow/web build → OK, mọi route ƒ Dynamic, Proxy (Middleware) có mặt
```
