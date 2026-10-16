# Kiến trúc Frontend & đặc tả UX (T-005)

> Ticket: T-005 (+ T-005b đồng bộ) · Tác giả: Engineer E (`taskflow-enterprise-b7`) · Trạng thái: **Đã duyệt (c3d8fbf); T-005b đồng bộ theo ADR-044/047/049/050/060–065/074/080–084 và đóng V1–V12 (mục 10)**
> Nguồn ưu tiên: `docs/blueprint/DECISIONS.md` (v1.1) > `docs/design/data-and-api.md` (T-003) & `docs/design/security.md` (T-002) > tài liệu này > blueprint v1.0.
> Ký hiệu: `ĐỀ XUẤT` = quyết định Engineer E tự đưa ra (đã được duyệt cùng T-005) · "Đã kiểm (Vn)" = phiên bản/API đã kiểm chứng, nguồn ở mục 10 · "chưa kiểm" = chi tiết API phải tra `.d.ts` khi code ở T-012, **không code theo phỏng đoán**.

## Mục lục
0. Nguyên tắc nền
1. Sitemap & màn hình (+ wireframe)
2. Cấu trúc FSD & luật import
3. State & dữ liệu: TanStack Query, auth, socket
4. Kanban & đồng bộ realtime
5. Ẩn/hiện theo quyền — `usePermission()`
6. Design system tối thiểu
7. Form & validation
8. Kế hoạch test FE
9. Ước lượng & chia việc Phase 4
10. Danh sách cần T-001 xác nhận

---

## 0. Nguyên tắc nền

| # | Nguyên tắc | Nguồn |
|---|---|---|
| P1 | Khu vực đăng nhập (`/w/...`, `/account`) **render client-side**. Next server chỉ phục vụ landing + HTML shell. Server Next **không bao giờ** biết access token. | ADR-026 |
| P2 | Access token chỉ ở **bộ nhớ JS** (biến module), không localStorage/sessionStorage/cookie/URL. Reload ⇒ `POST /auth/refresh`. | ADR-026, security §2.1 |
| P3 | Server là nguồn sự thật. UI ẩn/khóa theo quyền chỉ là tiện ích; mọi lỗi 403/404/409/422 phải được xử lý êm. | ADR-021, T-005 |
| P4 | Component ≤ 150 dòng; cấm `fetch`/`axios` trong `.tsx`; ≤ 3 `useState`/component. Máy ép (mục 2.4). | ADR-004, blueprint §2.1 |
| P5 | Kiểu dữ liệu & luật validate lấy từ `packages/contracts` — FE **không** tự định nghĩa lại DTO. | ADR-001 |
| P6 | Giao diện tiếng Việt; FE rẽ nhánh theo `error.code` (+ `details.rule`), không theo `message`. | T-003 §3.1 |

**Hệ quả quan trọng của P1/P2:** cookie refresh là host-only trên `api.example.com` (không `Domain`, security §2.3, ADR-109): staging/production `__Host-tf_rt; Secure; HttpOnly; SameSite=Strict; Path=/`, dev (http://localhost) `tf_rt; HttpOnly; SameSite=Strict; Path=/api/v1/auth` (`apps/api/src/modules/auth/presentation/refresh-cookie.ts`) ⇒ server Next (`app.example.com`) **không đọc được** cookie đó. Vì vậy **không có** redirect đăng nhập phía server (không dùng middleware/proxy của Next cho auth); cổng xác thực nằm ở client (`AuthGate`, mục 3.3).

---

## 1. Sitemap & màn hình

### 1.1. Route

Định danh trong URL dùng **id (uuid)**, không dùng slug: slug workspace đổi được (`PATCH /workspaces/:wsId`) ⇒ link cũ gãy; API cũng định tuyến theo id. Task dùng query param `?task=<taskId>` (không có endpoint tra theo key `TF-101`). ĐỀ XUẤT.

| Route (Next App Router) | Màn | Render | Quyền tối thiểu |
|---|---|---|---|
| `/` | Landing | Server (tĩnh) | Public |
| `/login` | Đăng nhập | Client | Chưa đăng nhập (đã đăng nhập ⇒ chuyển `/w`) |
| `/register` | Đăng ký | Client | Chưa đăng nhập |
| `/w` | Chọn workspace (tự chuyển tới workspace gần nhất nếu có); khu "Workspace đã xóa — khôi phục được" cho OWNER (ADR-050) | Client | Đã đăng nhập |
| `/w/new` | Tạo workspace | Client | Đã đăng nhập |
| `/w/[wsId]` | Chuyển hướng → `/w/[wsId]/projects` | Client | VIEWER |
| `/w/[wsId]/projects` | Danh sách project (tab Đang hoạt động / Đã lưu trữ) | Client | VIEWER (nút tạo: PM) |
| `/w/[wsId]/p/[projectId]` | **Board Kanban** | Client | VIEWER (kéo thả: MEMBER) |
| `/w/[wsId]/p/[projectId]?task=[taskId]` | Board + **Drawer chi tiết task** | Client | VIEWER (sửa: MEMBER) |
| `/w/[wsId]/p/[projectId]/settings` | Cài đặt project (tên, mô tả, lưu trữ) | Client | PM (VIEWER/MEMBER xem chỉ đọc) |
| `/w/[wsId]/settings` | Cài đặt workspace (tên, slug, xóa) | Client | VIEWER xem; OWNER sửa/xóa |
| `/w/[wsId]/settings/members` | **Thành viên** | Client | VIEWER xem; PM thêm/xóa; OWNER đổi role |
| `/account` | Hồ sơ (sửa họ tên — ADR-083), đổi mật khẩu, đăng xuất mọi thiết bị | Client | Đã đăng nhập |
| (mọi route lạ) | 404 chung | — | — |

**Chi tiết task: Drawer phải, không phải modal, không phải trang riêng** (ĐỀ XUẤT). Lý do: (1) người dùng vẫn thấy board → thấy thẻ di chuyển realtime khi đang đọc; (2) URL `?task=` chia sẻ được, nút Back đóng drawer; (3) modal che board và chặn tương tác. Màn hẹp (< 768px) drawer chiếm toàn màn.

**Không phân biệt "không tồn tại" và "không có quyền"**: API trả 404 cho cả hai (ADR-020) ⇒ FE hiển thị cùng một màn "Không tìm thấy hoặc bạn không có quyền truy cập".

### 1.2. Mô tả từng màn

| Màn | Mục đích | Loading | Empty | Error |
|---|---|---|---|---|
| Landing | Giới thiệu, nút Đăng nhập/Đăng ký | — (tĩnh) | — | — |
| Đăng nhập | Email + mật khẩu → `/w` hoặc `?next=` | Nút "Đang đăng nhập…" khóa form | — | `INVALID_CREDENTIALS` → thông báo chung dưới form; `RATE_LIMITED` → "Thử lại sau N giây" (đếm ngược từ `retryAfterSec`) |
| Đăng ký | Email, họ tên, mật khẩu (12–256 ký tự, ADR-049/065) → vào thẳng board project mặc định của `defaultWorkspaceId` | Khóa form | — | `EMAIL_ALREADY_EXISTS` → lỗi tại trường email; `VALIDATION_ERROR` → lỗi theo field (vd mật khẩu phổ biến) |
| Chọn workspace | Danh sách workspace của tôi + role; nút Tạo. Khu thu gọn "Đã xóa" (`GET /workspaces?deleted=true`, chỉ có dữ liệu khi tôi là OWNER): tên, "Xóa vĩnh viễn sau N ngày" (`purgeAt`), nút **Khôi phục** | Skeleton 3 thẻ | "Bạn chưa thuộc workspace nào" + nút Tạo; khu "Đã xóa" ẩn khi rỗng | Khối lỗi + Thử lại; khôi phục `404` (quá hạn/đã purge) ⇒ "Không thể khôi phục workspace này" + refetch danh sách |
| Danh sách project | Thẻ project (tên, key, mô tả); tab lưu trữ | Skeleton lưới | PM: "Chưa có dự án" + Tạo dự án · MEMBER/VIEWER: "Chưa có dự án nào" | 404 → màn Không tìm thấy; khác → Thử lại |
| **Board** | 4 cột, kéo thả, lọc theo người phụ trách/ưu tiên, tạo nhanh task | Skeleton 4 cột × 3 thẻ | Cột rỗng: vùng thả viền đứt "Thả task vào đây"; cả board rỗng: "Chưa có task" + Tạo task (nếu có quyền) | 404 → Không tìm thấy; mất socket → chấm trạng thái vàng "Đang kết nối lại…" (board vẫn dùng được); lỗi tải → Thử lại |
| **Drawer task** | Xem/sửa tiêu đề, mô tả, ưu tiên, hạn, người phụ trách; xóa; tab Lịch sử | Skeleton trong drawer | Lịch sử rỗng không xảy ra (luôn có CREATED) | 404 (task bị xóa) → "Task không còn tồn tại", đóng drawer; 409 → khối hòa giải (mục 4.6) |
| Cài đặt project | Sửa tên/mô tả, lưu trữ/khôi phục | Skeleton form | — | `PROJECT_ARCHIVED` khi sửa → báo "Khôi phục trước khi sửa" |
| Cài đặt workspace | Sửa tên/slug (slug: chữ thường/số/gạch nối 3–50, FE **không** tự lowercase — khớp R19); vùng nguy hiểm: xóa (gõ lại slug). Vùng nguy hiểm và dialog nói rõ: "Workspace sẽ biến mất ngay với mọi thành viên và bị xóa vĩnh viễn sau 30 ngày. Trong thời gian này chỉ Chủ sở hữu khôi phục được." (ADR-047; `features/workspace-delete`) | Skeleton form | — | `RESOURCE_CONFLICT field=slug` → lỗi tại slug ("đã được dùng hoặc là tên dành riêng"); xóa thành công ⇒ toast "Đã xóa …" + về `/w`; xóa `404` (đã bị xóa ở tab khác) ⇒ toast "Workspace không còn tồn tại" + về `/w`; xóa `400`/`409` (slug vừa đổi / không khớp) ⇒ refetch workspace, xóa ô nhập, báo "Slug vừa thay đổi hoặc không khớp. Gõ lại slug ở trên." |
| **Thành viên** | Danh sách, thêm theo email, đổi role, xóa, tự rời | Skeleton bảng 5 dòng | Không xảy ra (luôn có ≥1 OWNER) | `LAST_OWNER` → "Workspace phải còn ít nhất một Chủ sở hữu"; thêm user không hợp lệ → thông báo chung (security §6.5) |
| Tài khoản | Xem email; sửa họ tên (`PATCH /auth/me`, ADR-083); đổi mật khẩu; đăng xuất mọi thiết bị | Skeleton | — | `INVALID_CURRENT_PASSWORD` → lỗi tại trường mật khẩu hiện tại |

Ghi chú: `PATCH /auth/me` và tham số `q` của `GET members` đã được duyệt (ADR-083) nhưng **chưa có trong `data-and-api.md`** lúc viết T-005b. FE giả định: `PATCH /auth/me` body `{ fullName }` → `UserDto`; `GET members?q=` lọc theo họ tên/email (chứa, không phân biệt hoa thường), giữ phân trang cursor. Engineer C chốt chính thức — lệch thì FE theo contract.

### 1.3. Ma trận màn × role (hành động hiển thị)

| Hành động | OWNER | PM | MEMBER | VIEWER |
|---|:-:|:-:|:-:|:-:|
| Tạo/sửa/lưu trữ project | ✅ | ✅ | ẩn | ẩn |
| Tạo task, sửa nội dung, kéo thả | ✅ | ✅ | ✅ | ẩn (thẻ không có tay kéo) |
| Đổi người phụ trách (người nhận phải role ≥ MEMBER — ADR-044) | mọi task | mọi task | task mình tạo · tự nhận task trống · tự bỏ nhận | ẩn |
| Xóa task | mọi task | mọi task | task mình tạo | ẩn |
| Thêm thành viên | role bất kỳ | chỉ MEMBER/VIEWER | ẩn | ẩn |
| Đổi role | ✅ | ẩn | ẩn | ẩn |
| Xóa thành viên | bất kỳ (trừ OWNER cuối) | MEMBER/VIEWER | ẩn | ẩn |
| Rời workspace | ✅ (trừ OWNER cuối) | ✅ | ✅ | ✅ |
| Sửa/xóa workspace, khôi phục workspace đã xóa | ✅ | ẩn | ẩn | ẩn |

Project **đã lưu trữ**: mọi hành động ghi task **hiện nhưng khóa** kèm tooltip "Dự án đã lưu trữ — chỉ đọc" và banner trên board (khác "ẩn" theo role: người dùng cần biết vì sao không làm được).

### 1.4. Wireframe — Board Kanban

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ TaskFlow  │ Acme Corp ▾ │                                   ● Trực tuyến   (NA) ▾ │ ← AppHeader
├─────────────┼────────────────────────────────────────────────────────────────────────┤
│ DỰ ÁN     + │ Website Redesign · WEB                              [⚙ Cài đặt dự án]  │
│ ▸ Website ● │ Người phụ trách: [Tất cả ▾]  Ưu tiên: [Tất cả ▾]  🔍 Tìm…   [+ Tạo task] │ ← BoardToolbar
│ ▸ Mobile    │────────────────────────────────────────────────────────────────────────│
│ ▸ Backend   │ CẦN LÀM  12     │ ĐANG LÀM  5     │ KIỂM DUYỆT  2   │ HOÀN THÀNH  31     │
│             │┌───────────────┐│┌───────────────┐│┌───────────────┐│┌──────────────────┐│
│ ─────────── ││⠿ WEB-112      ││││⠿ WEB-98       ││││⠿ WEB-90       ││││⠿ WEB-77           ││
│ ⚙ Cài đặt   ││Sửa lỗi header ││││Trang thanh    ││││API đăng nhập  ││││Logo mới           ││
│ 👥 Thành viên││▲▲ Khẩn  📅15/10││││toán           ││││● TB    (TL)   ││││▽ Thấp            ││
│             ││         (NA)  ││││▲ Cao  ⚠14/10  ││││               ││││                  ││
│             │└───────────────┘│││        (MH)   │││└───────────────┘│└──────────────────┘│
│             │┌───────────────┐│└───────────────┘│ ┌ ─ ─ ─ ─ ─ ─ ─ ┐│  … 26 task nữa     │
│             ││⠿ WEB-113      ││                 │  Thả task vào đây │  [Hiện thêm]       │
│             ││…              ││                 │ └ ─ ─ ─ ─ ─ ─ ─ ┘│                    │
│             │└───────────────┘│                 │                 │                    │
│             │ [+ Thêm nhanh]  │                 │                 │                    │
└─────────────┴────────────────────────────────────────────────────────────────────────┘
 Khi đang kéo WEB-112 (đang ở CẦN LÀM): cột ĐANG LÀM sáng viền; KIỂM DUYỆT và HOÀN THÀNH
 mờ đi + biểu tượng ⊘ "Không thể chuyển từ Cần làm sang …" (state machine, mục 4.2).
 Project lưu trữ: banner vàng trên toolbar "Dự án đã lưu trữ — chỉ đọc. [Khôi phục]" (nút chỉ cho PM+).
 ⠿ = tay kéo (ẩn với VIEWER). ⚠ = quá hạn (dueDate < hôm nay và chưa DONE). (NA) = avatar chữ cái.
 "⋯" trên thẻ (hover/focus) mở menu: Chuyển tới ▸ (chỉ cột hợp lệ) · Lên đầu cột · Xuống cuối cột · Xóa.
```

### 1.5. Wireframe — Drawer chi tiết task

```
                               ┌────────────────────────────────────────────────┐
  (board vẫn hiển thị,         │ WEB-112                      🔗 Sao chép link  ✕ │
   phủ mờ nhẹ, click ra        │────────────────────────────────────────────────│
   ngoài = đóng drawer)        │ [Sửa lỗi header trên Safari________________]   │ ← title, lưu khi blur/Enter
                               │                                                │
                               │ Trạng thái   [Cần làm ▾]   (chỉ liệt kê đích   │
                               │                            hợp lệ + hiện tại)  │
                               │ Ưu tiên      [▲▲ Khẩn cấp ▾]                    │
                               │ Hạn chót     [15/10/2026 📅]  ⚠ Quá hạn 0 ngày   │
                               │ Phụ trách    [(NA) Nguyễn An ▾] [Nhận việc]     │
                               │ Người tạo    (TL) Trần Lan · 12/10/2026 09:14   │
                               │────────────────────────────────────────────────│
                               │ Mô tả                                          │
                               │ ┌────────────────────────────────────────────┐ │
                               │ │Header bị lệch 2px trên Safari 18 khi…      │ │
                               │ └────────────────────────────────────────────┘ │
                               │                           [Hủy]  [Lưu mô tả]   │
                               │────────────────────────────────────────────────│
                               │ [ Lịch sử ]                                    │
                               │ • Trần Lan đổi trạng thái Cần làm → Đang làm   │
                               │   2 phút trước                                 │
                               │ • Nguyễn An được giao task · hôm qua           │
                               │ • Trần Lan tạo task · 12/10                    │
                               │                         [Tải thêm]             │
                               │────────────────────────────────────────────────│
                               │ 🗑 Xóa task          (chỉ hiện khi canDelete)  │
                               └────────────────────────────────────────────────┘
 Khi 409 VERSION_CONFLICT không tự hòa giải được (mục 4.6), khối vàng xuất hiện dưới tiêu đề:
 ┌ ⚠ Trần Lan vừa sửa task này. Trường "Mô tả" của bạn khác bản mới nhất.          ┐
 │   [Xem bản mới nhất]   [Giữ bản của tôi]   [Bỏ thay đổi của tôi]                 │
 └──────────────────────────────────────────────────────────────────────────────────┘
 VIEWER / project lưu trữ: mọi trường ở dạng chỉ đọc (text, không phải input).
 Lịch sử dùng GET …/audit-logs (cursor, mới nhất trước); task:* realtime đẩy mục mới vào đầu (invalidate).
```

### 1.6. Wireframe — Thành viên workspace

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Cài đặt workspace › Thành viên                                        42 người   │
│ [ Chung ]  [ Thành viên ]                                                        │
│──────────────────────────────────────────────────────────────────────────────────│
│ Thêm thành viên (PM+)                                                            │
│ Email [ten@congty.vn________________]  Vai trò [Thành viên ▾]   [Thêm]           │
│   (PM chỉ thấy Thành viên / Người xem trong danh sách vai trò)                   │
│──────────────────────────────────────────────────────────────────────────────────│
│ 🔍 Tìm theo tên/email (server `?q=`, debounce 300ms — ADR-083)                   │
│ ┌──────────────────────────────────┬──────────────────┬────────────┬───────────┐ │
│ │ Thành viên                       │ Vai trò          │ Tham gia   │           │ │
│ ├──────────────────────────────────┼──────────────────┼────────────┼───────────┤ │
│ │ (NA) Nguyễn An  (bạn)            │ Chủ sở hữu  ▾    │ 01/09/2026 │ Rời       │ │
│ │      an@acme.vn                  │                  │            │           │ │
│ │ (TL) Trần Lan                    │ Quản lý dự án ▾  │ 03/09/2026 │ Xóa       │ │
│ │ (MH) Mai Hoa                     │ Thành viên  ▾    │ 05/09/2026 │ Xóa       │ │
│ │ (VK) Vũ Khang                    │ Người xem   ▾    │ 10/09/2026 │ Xóa       │ │
│ └──────────────────────────────────┴──────────────────┴────────────┴───────────┘ │
│                                 [Tải thêm]                                       │
└──────────────────────────────────────────────────────────────────────────────────┘
 Ô vai trò là Select chỉ với OWNER; người khác thấy Badge chữ.
 "Xóa": Dialog xác nhận "Xóa Mai Hoa khỏi workspace? Các task đang giao cho người này sẽ
  bị bỏ giao." → sau thành công hiển thị toast "Đã xóa. 7 task được bỏ giao" (unassignedTaskCount).
 "Rời" (chính mình): Dialog xác nhận → thành công ⇒ về /w.
 Đổi role xuống "Người xem": Dialog xác nhận "Người xem không được giao việc — các task đang giao cho
  Mai Hoa sẽ bị bỏ giao." (ADR-044) → toast "Đã đổi vai trò. N task được bỏ giao" (unassignedTaskCount).
 Hạ OWNER cuối cùng / OWNER cuối tự rời: nút vẫn bấm được, server trả LAST_OWNER → toast lỗi
  (FE không tự đếm OWNER vì danh sách phân trang có thể chưa tải hết).
```

---

## 2. Cấu trúc FSD & luật import

### 2.1. Vị trí thư mục trong `apps/web`

```
apps/web/
├── app/                  ← Next App Router: CHỈ file định tuyến mỏng (page/layout/error/not-found)
├── proxy.ts              ← CSP nonce (Next 16 đổi middleware → proxy); đặt ở GỐC vì app/ ở gốc
├── src/
│   ├── app/              ← FSD layer "app": providers, AuthGate, global CSS, cấu hình QueryClient
│   ├── views/            ← FSD layer "pages" (đổi tên "views" để không đụng Pages Router của Next)
│   ├── widgets/
│   ├── features/
│   ├── entities/
│   └── shared/
└── e2e/                  ← Playwright
```

- Route Next ở `apps/web/app/` (gốc) để FSD dùng `src/`. **Đã kiểm chứng (V1):** Next bỏ qua `src/app` khi có `app/` ở gốc ("`src/app` or `src/pages` will be ignored if `app` or `pages` are present in the root directory" — nextjs.org/docs/app/api-reference/file-conventions/src-folder).
- ⚠️ **Cấm tạo `apps/web/src/pages/`** (kể cả rỗng): Next tìm `pages` và `app` độc lập (ưu tiên gốc, rồi `src/`) và báo lỗi build "`pages` and `app` directories should be under the same folder" khi chúng khác thư mục cha (nguồn: `packages/next/src/lib/find-pages-dir.ts`). Đây là lý do layer "pages" của FSD tên là `views`. Rule dependency-cruiser/CI kiểm thư mục này không tồn tại.
- `globals.css` (`@import "tailwindcss"` + `@theme`) nằm ở `src/app/styles/globals.css`, import từ `app/layout.tsx` gốc — **khác** sơ đồ `src/app/globals.css` ở stack-versions §10 (sơ đồ đó giả định Next router trong `src/app`).
- File route chỉ làm 1 việc: render view. Ví dụ `app/(app)/w/[wsId]/p/[projectId]/page.tsx` → `export { BoardPage as default } from '@/views/board'`. View đọc params bằng `useParams()` (client). Không fetch dữ liệu ở server component (ADR-026).
- Nhóm route: `app/(marketing)/page.tsx` (landing, server), `app/(auth)/{login,register}` (layout có `GuestGate`), `app/(app)/…` (layout client có `AuthGate` + `AppShell`).

### 2.2. Slice cụ thể

Mỗi slice có **public API duy nhất** là `index.ts`; segment chuẩn: `ui/`, `model/` (hook, store, logic thuần), `api/` (gọi HTTP), `lib/` (helper), `config/`.

**shared/** (không biết gì về nghiệp vụ TaskFlow ngoài type từ contracts)

| Segment | Nội dung | Public API |
|---|---|---|
| `shared/api` | `http` client (fetch + envelope + `ApiError`), `refreshCoordinator` interface hook-in, `withClientId` | `http`, `ApiError`, `isApiError(code)` |
| `shared/config` | `runtime-config.ts` (store module `{ apiUrl, wsUrl, appEnv }` nhận lúc chạy — mục 3.6, ADR-074; **không** dùng `NEXT_PUBLIC_*` cho URL), `routes.ts` (hàm dựng URL kiểu an toàn) | `getRuntimeConfig`, `RuntimeConfigBoot`, `routes` |
| `shared/lib` | `client-id.ts` (uuid theo tab), `rank.ts` (so sánh byte `a < b`), `date-only.ts` (YYYY-MM-DD, quá hạn), `lru-set.ts`, `cn.ts`, `safe-next-path.ts` (chống open redirect) | từng file một `index.ts` con |
| `shared/socket` | Tạo client Socket.io có kiểu `ServerToClientEvents/ClientToServerEvents` từ contracts; **nơi duy nhất** import `socket.io-client` | `createRealtimeClient`, `RealtimeClient` (interface) |
| `shared/query` | `createQueryClient()` (mặc định mục 3.1) | `createQueryClient` |
| `shared/i18n` | Chuỗi tiếng Việt theo miền: `vi/common.ts`, `vi/task.ts`, `vi/errors.ts` (map `ErrorCode` → câu thông báo) | mỗi file tự export |
| `shared/ui` | Component nguyên thủy (mục 6.3), **mỗi component một thư mục + index riêng** (`shared/ui/button`) — không có barrel chung để 2 người không sửa chung 1 file | `@/shared/ui/button`, … |

**entities/** (dữ liệu nghiệp vụ + hiển thị "câm")

| Slice | model | api | ui |
|---|---|---|---|
| `session` | `token-store.ts` (biến module + subscribe), `session-store.ts` (status: `bootstrapping \| authenticated \| anonymous`, user), `refresh.ts` (single-flight + Web Locks), `auth-channel.ts` (BroadcastChannel) | `auth.api.ts` (refresh, me, logout, logout-all) | — |
| `user` | — | — | `UserAvatar`, `UserName` |
| `workspace` | `query-keys`, `useWorkspaces`, `useDeletedWorkspaces`, `useWorkspace(wsId)`, `useCurrentWorkspaceId`, **`usePermission`** (bảng quyền import từ contracts — mục 5) | `workspace.api.ts` | `RoleBadge`, `WorkspaceCard`, `DeletedWorkspaceRow` |
| `member` | `useMembers(wsId, q)` (infinite, tìm server), `useAssignableMembers(wsId, q)` (picker: lọc role ≥ MEMBER — ADR-044) | `member.api.ts` | `MemberRow` (chỉ hiển thị) |
| `project` | `useProjects`, `useProject` | `project.api.ts` | `ProjectCard`, `ArchivedBadge` |
| `task` | `query-keys`, `board-cache.ts` (kiểu `BoardData`, hàm thuần upsert/remove/sort), `transitions.ts` (bọc `TASK_STATUS_TRANSITIONS` từ contracts — ADR-080), `policy.ts` (canDelete/canAssign dạng hàm thuần), `useBoard`, `useTask` | `task.api.ts` | `TaskCard` (memo, không biết dnd), `PriorityBadge`, `StatusBadge`, `DueDate` |
| `audit-log` | `useTaskAuditLogs` (infinite) | `audit.api.ts` | `AuditEntry` |

**features/** (hành động của người dùng — mỗi slice 1 use case)

| Slice | Nội dung |
|---|---|
| `auth-login`, `auth-register` | Form + mutation, chuyển hướng sau thành công |
| `auth-logout` | Đăng xuất / đăng xuất mọi thiết bị (kèm dialog xác nhận) |
| `change-password` | Form đổi mật khẩu |
| `workspace-create`, `workspace-edit`, `workspace-delete`, `workspace-restore`, `workspace-switch` | |
| `profile-edit` | Sửa họ tên (`PATCH /auth/me`), cập nhật `['me']` |
| `member-add`, `member-change-role`, `member-remove` (gồm tự rời) | |
| `project-create`, `project-edit`, `project-archive` | |
| `task-create` | Dialog tạo + "Thêm nhanh" cuối cột TODO |
| `task-edit` | Sửa field trong drawer + hòa giải 409 (mục 4.6) |
| `task-move` | `computeMoveIntent` (thuần), `useMoveTask` (optimistic), menu "Chuyển tới" |
| `task-assign` | Picker người phụ trách + "Nhận việc"/"Bỏ nhận" |
| `task-delete` | Dialog xác nhận + mutation |
| `board-filter` | Bộ lọc client-side (assignee/priority/tìm chữ), trạng thái ở URL query |
| `board-realtime` | `applyRealtimeEvent` (reducer thuần), `useBoardRealtime(ws, project)` (join phòng, merge cache, refetch khi reconnect) |
| `realtime-session` | Lắng nghe `workspace:access-revoked`, `member:role-changed`, `auth:expired` (cấp ứng dụng) |

**widgets/**: `app-header` (logo, workspace switcher, trạng thái kết nối, menu người dùng) · `project-sidebar` · `kanban-board` (DragDropProvider + cột + overlay) · `task-detail-drawer` · `member-table` · `project-grid` · `board-toolbar`.

**views/**: `login`, `register`, `workspace-picker`, `workspace-new`, `project-list`, `board`, `project-settings`, `workspace-settings`, `members`, `account`, `not-found`.

**app/** (layer FSD): `providers/` (QueryClientProvider, RealtimeProvider, Toaster, ThemeProvider), `auth-gate.tsx`, `guest-gate.tsx`, `app-shell.tsx`, `styles/globals.css`.

### 2.3. Luật import

1. Chiều phụ thuộc chỉ đi xuống: `app(Next route)` → `src/app` → `views` → `widgets` → `features` → `entities` → `shared` → `packages/contracts`. Không bao giờ ngược lên.
2. **Cùng layer, khác slice: cấm import nhau** (`features/task-move` không import `features/task-edit`). Ngoại lệ duy nhất: entities được tham chiếu nhau qua API chéo tường minh `entities/A/@x/B.ts` (quy ước FSD), dùng cho kiểu (vd `task` cần `UserRef` của `user`). Cần ghép 2 feature ⇒ làm ở widget.
3. Import từ slice khác **chỉ qua `index.ts`** (`@/entities/task`), cấm đường sâu (`@/entities/task/model/board-cache`). Trong cùng slice dùng đường tương đối.
4. `shared/` không import layer nào phía trên; `shared/ui` không import `@tanstack/react-query`, `shared/api`, `shared/socket`.
5. Thư viện bị khoanh vùng: `socket.io-client` chỉ trong `shared/socket`; `@dnd-kit/*` (gồm `@dnd-kit/react`, `/helpers`, `/dom`) chỉ trong `widgets/kanban-board` và `features/task-move`; `radix-ui` và `sonner` chỉ trong `shared/ui`; `fractional-indexing` chỉ trong `entities/task` (rank tạm cho optimistic).
6. `packages/contracts` được import ở mọi layer (là "shared" cấp monorepo). Cấm import `apps/api`.
7. Cấm `fetch`/`axios` ngoài `shared/api` và cấm tuyệt đối trong `.tsx`. Gọi mạng chỉ trong segment `api/` của slice, thông qua `http`.

### 2.4. Máy ép (ADR-004) — rule cụ thể cho Phase 1

**dependency-cruiser** (`apps/web/.dependency-cruiser.cjs`):

| Tên rule | from | to (cấm) |
|---|---|---|
| `fsd-no-upward-shared` | `^src/shared/` | `^src/(entities\|features\|widgets\|views\|app)/` |
| `fsd-no-upward-entities` | `^src/entities/` | `^src/(features\|widgets\|views\|app)/` |
| `fsd-no-upward-features` | `^src/features/` | `^src/(widgets\|views\|app)/` |
| `fsd-no-upward-widgets` | `^src/widgets/` | `^src/(views\|app)/` |
| `fsd-no-upward-views` | `^src/views/` | `^src/app/` |
| `fsd-no-cross-slice` | `path: ^src/(features\|widgets\|views)/([^/]+)/` | `path: ^src/$1/[^/]+/` · `pathNot: ^src/$1/$2/` (cùng layer, slice khác) |
| `fsd-entities-cross-via-x` | `path: ^src/entities/([^/]+)/` | `path: ^src/entities/[^/]+/` · `pathNot: ^src/entities/($1/\|[^/]+/@x/$1\.ts$)` (sang entity khác chỉ qua `@x/<tên-mình>.ts`) |
| `fsd-public-api-only` | `path: ^(src\|app)/` · `pathNot: ^src/(entities\|features\|widgets\|views)/([^/]+)/` cùng slice — viết 4 rule, mỗi layer một rule với nhóm `$1` | `path: ^src/<layer>/[^/]+/.+` · `pathNot: ^src/<layer>/[^/]+/index\.ts$` |
| `route-files-thin` | `^app/` | `^src/(widgets\|features\|entities)/` (route chỉ import `views` và `src/app`) |
| `no-api-app` | `^(app\|src)/` | `^(\.\./)*apps/api/` |
| `no-circular` | mọi | vòng lặp |

**Đã kiểm chứng (V11a):** dependency-cruiser 18 hỗ trợ "group matching" — nhóm bắt trong `from.path` dùng lại bằng `$1`, `$2`… trong `to.path`/`to.pathNot` (doc/rules-reference.md). Mỗi rule phải có test fixture (1 import hợp lệ + 1 vi phạm) trong `packages/config` để chắc regex đúng ý. Cân nhắc thêm `steiger` (linter FSD) chạy song song, không bắt buộc.

**ESLint 10** (flat config tự ghép — ADR-064, không dùng `eslint-config-next`; `packages/config/eslint/next.js`):
- `max-lines`: `{ max: 150, skipBlankLines: true, skipComments: true }` cho `src/**/*.tsx`; `max-lines: 200` cho `src/**/*.ts`.
- `no-restricted-globals`: `fetch`, `XMLHttpRequest`, `localStorage`, `sessionStorage` — **bật cho `src/**`**, tắt riêng cho `src/shared/api/**` (fetch) và `src/shared/lib/storage.ts` (wrapper localStorage cho dữ liệu không nhạy cảm như workspace gần nhất).
- `no-restricted-imports`: `axios` (mọi nơi); `socket.io-client` ngoài `src/shared/socket/**`; `@dnd-kit/*` ngoài 2 slice ở 2.3-5; `@tanstack/react-query` trong `src/shared/ui/**`; mẫu `@/*/*/*/**` (cấm đường sâu, bổ trợ dependency-cruiser).
- Cấm `dangerouslySetInnerHTML` bằng rule core `no-restricted-syntax` với selector `JSXAttribute[name.name='dangerouslySetInnerHTML']` — vì XSS = mất phiên (security §6.2). Không dùng `react/no-danger` vì `eslint-plugin-react` chưa hỗ trợ ESLint 10 (stack-versions §5). Cùng rule cấm `CallExpression[callee.name='fetch']` trong `**/*.tsx` (khớp T-008). Selector suy ra từ đặc tả AST của typescript-eslint, chưa chạy thử ⇒ test fixture (1 vi phạm phải đỏ) là bắt buộc.
- Không có `eslint-plugin-jsx-a11y` (ADR-064) ⇒ a11y được ép bằng `@axe-core/playwright` trong E2E (mục 8) + review.
- **Rule tự viết `taskflow/max-use-state`** (plugin local trong `packages/config`, ~40 dòng): đếm lời gọi `useState` trong mỗi function component, > 3 ⇒ lỗi. Áp cho mọi `.tsx` (đơn giản hơn phân loại "presentational"; component cần nhiều state hơn ⇒ chuyển sang `useReducer` trong `model/`).
- `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`: error.

---

## 3. State & dữ liệu

### 3.1. Chọn công cụ

| Loại state | Công cụ | Lý do |
|---|---|---|
| Server state (workspace, project, task, member, audit) | **TanStack Query** | Cache, dedupe, retry, optimistic, invalidation — đúng bài toán. |
| Phiên đăng nhập (token, user, status) | **Biến module + `useSyncExternalStore`** | `http` client (không phải React) phải đọc token đồng bộ; không cần thư viện. |
| UI cục bộ (drawer mở, filter) | URL query (`?task=`, `?assignee=`) + `useState`/`useReducer` | URL chia sẻ được, Back hoạt động. |
| Trạng thái kéo thả tạm | `useReducer` trong `widgets/kanban-board/model` | Chỉ sống trong lúc kéo. |

**Không dùng Redux/Zustand.** Không có state client toàn cục phức tạp nào ngoài phiên; thêm store thứ hai sẽ sinh hai nguồn sự thật với Query cache.

Mặc định `QueryClient` (`shared/query`):

```ts
// @tanstack/react-query 5.104.2 (V5 đã kiểm: `gcTime` là tên đúng, mặc định 5 phút)
defaultOptions: {
  queries: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: (count, err) => count < 2 && (!isApiError(err) || err.status >= 500), // tối đa 2 lần, không retry 4xx
    refetchOnWindowFocus: true,
  },
  mutations: { retry: false },  // ghi không tự retry (409/422 cần người quyết)
}
```

### 3.2. Query keys

Mọi key thuộc workspace bắt đầu bằng `['ws', wsId]` ⇒ khi mất quyền chỉ cần `removeQueries({ queryKey: ['ws', wsId] })`.

| Key | Dữ liệu | staleTime | Ghi chú |
|---|---|---|---|
| `['me']` | `MeResponse` | 5 phút | invalidate khi tạo/rời workspace, đổi role |
| `['workspaces']` | `WorkspaceDto[]` | 60s | |
| `['workspaces', 'deleted']` | `DeletedWorkspaceDto[]` | 60s | invalidate sau xóa/khôi phục |
| `['ws', wsId]` | `WorkspaceDto` (có `myRole`) | 60s | nguồn của `usePermission` |
| `['ws', wsId, 'members', 'list', { q }]` | infinite `MemberDto[]` | 60s | bảng thành viên, `q` từ ô tìm (ADR-083) |
| `['ws', wsId, 'members', 'assignable', { q }]` | `MemberDto[]` trang đầu (limit 20) lọc role ≥ MEMBER | 60s | picker người phụ trách (gõ để tìm, không tải hết) |
| `['ws', wsId, 'projects', { archived }]` | infinite `ProjectDto[]` | 60s | |
| `['ws', wsId, 'project', projectId]` | `ProjectDto` | 60s | cập nhật bởi `project:updated` |
| `['ws', wsId, 'project', projectId, 'board']` | `BoardData` | **Infinity** | giữ tươi bằng socket; refetch khi reconnect/join lại; `refetchOnWindowFocus: false` |
| `['ws', wsId, 'project', projectId, 'task', taskId]` | `TaskDto` | Infinity | **chỉ** dùng khi deep-link task chưa có trong board; còn lại drawer đọc từ board cache |
| `['ws', wsId, 'project', projectId, 'task', taskId, 'audit']` | infinite `AuditLogDto[]` | 0 | invalidate khi có event cho task đó |

Key được sinh bởi factory trong `model/query-keys.ts` của từng entity, cấm viết mảng tay ở nơi khác.

`BoardData = { byId: Record<TaskId, TaskDto> }` — chuẩn hóa theo id, cột được **suy ra** (`groupBy status` + sort `rank, id` theo so sánh byte) bằng `select` + `useMemo`. Lý do: merge event chỉ thay 1 phần tử; các `TaskDto` không đổi giữ nguyên tham chiếu ⇒ `React.memo(TaskCard)` bỏ qua render. Tải board: gọi `GET …/tasks?limit=500` lặp theo `nextCursor` tới khi `hasMore=false` (thường 1 request).

### 3.3. Auth bootstrap & vòng đời token

**Token store** (`entities/session/model/token-store.ts`): `{ accessToken, expiresAt }` trong biến module; API `get()`, `set()`, `clear()`, `subscribe()`. Không bao giờ log token.

**Bootstrap** (khi `AuthGate` mount — mỗi lần tải trang):

```
status = 'bootstrapping'  → hiển thị splash (logo + spinner), KHÔNG render route con
refresh()  (single-flight, xem dưới)
  ├─ 200 → token-store.set → GET /auth/me → session.user = …; status = 'authenticated'
  │        → lên lịch refresh chủ động; mở socket (mục 3.5)
  └─ 401 REFRESH_TOKEN_INVALID / 403 ORIGIN_NOT_ALLOWED
           → status = 'anonymous' → router.replace('/login?next=' + safePath(current))
  └─ lỗi mạng / 5xx → màn "Không kết nối được máy chủ" + Thử lại (KHÔNG đẩy về login)
```

`GuestGate` (trang login/register) cũng thử `refresh()` một lần: thành công ⇒ chuyển `/w` (người dùng có phiên thì không phải đăng nhập lại).

`?next=` chỉ chấp nhận đường dẫn tương đối bắt đầu bằng `/` và không bắt đầu bằng `//` (`safe-next-path.ts`) — chống open redirect.

**Single-flight refresh** (`entities/session/model/refresh.ts`):
1. Trong tab: giữ 1 promise `inflight`; mọi lời gọi `refresh()` trong lúc đó nhận cùng promise.
2. Xuyên tab: bọc trong `navigator.locks.request('tf-refresh', …)` (security §1.4). Web Locks và `BroadcastChannel` có từ Chrome 69/54, Firefox 96/38, Safari 15.4 (MDN BCD — V12) ⇒ đủ cho trình duyệt tối thiểu của Tailwind 4 (Safari 16.4/Chrome 111/Firefox 128). Web Locks **chỉ có trong secure context** (HTTPS; `localhost` cũng tính) ⇒ `navigator.locks` vắng mặt thì chỉ single-flight trong tab (dựa vào 409 bên dưới), không throw.
3. `409 REFRESH_IN_PROGRESS` ⇒ đợi 300ms, thử lại **1 lần**.
4. Thành công ⇒ `token-store.set`, phát `auth:renew` lên socket nếu đang mở (mục 3.5), lên lịch lần kế.

**Refresh chủ động**: hẹn giờ `expiresIn − 60s`. Tab ẩn bị trình duyệt hãm timer ⇒ thêm kiểm tra khi `visibilitychange → visible`: còn < 60s thì refresh ngay.

**`http` client** (`shared/api/http.ts`) — luồng mỗi request:

```
await refreshCoordinator.idle()        // đang refresh ⇒ request xếp hàng chờ (hàng đợi)
gắn headers: Authorization (nếu có token), Content-Type: application/json,
             X-Client-Id (mọi request ghi), credentials: 'include' CHỈ cho /auth/*
gửi → parse envelope
  success=true  → (dev/test: Zod parse `data` bằng schema contracts; prod: parse các response nhỏ,
                   bỏ parse danh sách task lớn — TODO đo ở Phase 4) → trả data
  401 TOKEN_EXPIRED (và request chưa retry) → await refresh() → gửi lại 1 lần
  401 khác (UNAUTHORIZED: tv lệch, sid bị thu hồi) → sessionEnded('revoked')
  còn lại → throw ApiError { status, code, message, details, requestId }
```

**Refresh thất bại / phiên kết thúc** (`sessionEnded(reason)`): `token-store.clear()` → ngắt socket → `queryClient.clear()` → phát `logout` trên `BroadcastChannel('tf-auth')` → `router.replace('/login')` + toast "Phiên đăng nhập đã hết. Vui lòng đăng nhập lại." Các request đang xếp hàng bị reject bằng `ApiError(UNAUTHORIZED)` và UI không hiện thêm toast lỗi (lọc theo cờ `sessionEnding`).

**Đồng bộ đa tab** (`BroadcastChannel('tf-auth')`): `logout` ⇒ các tab khác gọi `sessionEnded('logout')` ngay (không phải chờ 401); `login` ⇒ tab đang ở `/login` chạy lại bootstrap. Mỗi tab có access token riêng (bộ nhớ không chia sẻ) — chấp nhận.

**Đăng xuất**: `POST /auth/logout` (credentials include) → luôn `sessionEnded('logout')` kể cả khi request lỗi mạng. **Đăng xuất mọi thiết bị**: dialog xác nhận → `POST /auth/logout-all` → `sessionEnded`. **Đổi mật khẩu**: response trả token mới ⇒ `token-store.set`; server ngắt mọi socket của user ⇒ socket tab này tự kết nối lại bằng token mới.

**`X-Client-Id`**: `crypto.randomUUID()` một lần khi module nạp, giữ trong **bộ nhớ**. Không dùng `sessionStorage` — trình duyệt sao chép sessionStorage khi nhân bản tab, hai tab sẽ trùng id và bỏ qua event của nhau.

### 3.4. Xử lý lỗi chung

| Lỗi | Cách FE xử lý mặc định (có thể ghi đè tại chỗ) |
|---|---|
| `VALIDATION_ERROR` | Map `fieldErrors` vào form (mục 7.3); ngoài form ⇒ toast |
| `RESOURCE_NOT_FOUND` | Query trang ⇒ màn Không tìm thấy; mutation ⇒ xóa phần tử khỏi cache + toast |
| `FORBIDDEN_ACCESS` | Toast "Bạn không có quyền thực hiện thao tác này" + invalidate `['ws', wsId]` (role có thể vừa đổi) |
| `PROJECT_ARCHIVED` | Invalidate project ⇒ board chuyển chỉ đọc + toast |
| `RATE_LIMITED` | Toast với số giây `retryAfterSec` |
| `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, lỗi mạng | Toast chung kèm `requestId` rút gọn (để hỗ trợ tra log) |

Mỗi route có `error.tsx` (error boundary) hiển thị khối lỗi + Thử lại; không bao giờ hiện stack.

### 3.5. Socket client

- Một kết nối cho mỗi phiên, tạo bởi `RealtimeProvider` (layer `src/app`) **sau** khi `status = 'authenticated'`; hủy khi `sessionEnded`.
- `io(getRuntimeConfig().wsUrl, { transports: ['websocket'], autoConnect: false, auth: (cb) => cb({ token: tokenStore.get(), clientId }), withCredentials: false })` — URL lấy từ runtime config (mục 3.6, ADR-074), **không** `NEXT_PUBLIC_*`. Chỉ transport websocket (ADR-074: không cần sticky session; server từ chối `polling` — SEC-56). Token không trong query string (security §5.1). Callback `auth` được gọi lại **mỗi lần (re)connect** ⇒ luôn lấy token mới nhất (stack-versions §3, socket.io-client 4.8.4). `autoConnect: false` ⇒ `RealtimeProvider` gọi `connect()` sau khi có token.
- Server kiểm `Origin` ở handshake (`allowRequest`, security §5.1 / SEC-56) — trình duyệt tự gửi `Origin` của trang, FE không làm gì thêm. Bị từ chối ở bước này (cấu hình whitelist sai) ⇒ `connect_error` **không có** `err.data.code` ⇒ coi là lỗi transport: để socket.io tự kết nối lại theo backoff, header hiện "Mất kết nối thời gian thực", **không** kết thúc phiên; log lên Sentry (một lần mỗi phiên) để vận hành thấy cấu hình sai.
- `connect_error` với `err.data.code === 'TOKEN_EXPIRED'` ⇒ `refresh()` rồi `socket.connect()`; `UNAUTHORIZED` ⇒ `sessionEnded('revoked')`.
- Mạng chặn WebSocket (proxy doanh nghiệp cũ): không có fallback polling — board vẫn dùng được qua REST, chỉ mất cập nhật tự động; header giữ trạng thái "Mất kết nối thời gian thực" kèm nút "Tải lại bảng" (refetch thủ công). Đánh đổi đã chấp nhận ở ADR-074.
- Sau mỗi `refresh()` thành công ⇒ `emit('auth:renew', { token }, ack)`; `ack.ok === false` ⇒ server sẽ ngắt ⇒ để cơ chế kết nối lại chạy.
- `auth:expired` ⇒ `refresh()`; socket bị server ngắt ⇒ tự kết nối lại bằng token mới.
- Trạng thái kết nối (`connected | reconnecting | offline`) hiển thị ở `app-header` (chấm màu + chữ, không chỉ màu).
- Sự kiện cấp ứng dụng (`features/realtime-session`):
  - `workspace:access-revoked { workspaceId }` (bị xóa/tự rời, **hoặc workspace bị xóa mềm** — phát cho mọi thành viên) ⇒ `removeQueries(['ws', workspaceId])`, invalidate `['workspaces']`, `['workspaces', 'deleted']`, `['me']`; nếu đang ở workspace đó ⇒ về `/w` + toast trung tính "Bạn không còn truy cập được workspace này" (payload không phân biệt hai lý do — không đoán).
  - `member:role-changed { workspaceId, role }` ⇒ `setQueryData(['ws', workspaceId], …myRole = role)` ⇒ `usePermission` cập nhật tức thì; toast "Vai trò của bạn đã đổi thành …". Hạ xuống VIEWER: các task của mình bị bỏ giao — đến qua `task:updated` bình thường (ADR-044), FE không cần xử lý riêng.
  - Đường dự phòng khi socket đang rớt: thao tác thành viên nhận `404` với `details.resource = 'workspace'` (mình vừa bị xóa/hạ, hoặc workspace đã xóa) ⇒ xử lý y như `workspace:access-revoked` (`isWorkspaceGone` + `forgetWorkspace` của `entities/workspace`); `404 user` ⇒ "Người này không còn trong workspace" + làm mới bảng (G1 W1/W2).
- **Không live (có chủ đích, G1 I1):** `member:role-changed` chỉ tới phòng `user:{id}` của người bị đổi; `project:updated` chỉ tới phòng project (chỉ board join). Bảng thành viên của admin khác, danh sách dự án (tab lưu trữ) và trang cài đặt dự án **không** tự cập nhật — dựa vào `staleTime` 60 s / refetch khi focus, và lỗi server (`VERSION_CONFLICT`, `PROJECT_ARCHIVED`, `404`) ⇒ invalidate detail. `project:updated` không có version ⇒ board bỏ event có `updatedAt` cũ hơn bản đang có, bằng nhau thì nhận (G1 W4). PATCH workspace/project là last-write-wins (ADR-117).

### 3.6. Cấu hình runtime (ADR-074, ADR-084)

Một image web cho mọi môi trường ⇒ URL API/WS **không** nhúng lúc build.
- Server Next đọc `API_URL`, `WS_URL` (mặc định = `API_URL`), `APP_ENV`, `SENTRY_DSN` từ `process.env` **lúc chạy**, parse bằng Zod trong `src/app/config/server-env.ts` (thiếu/sai ⇒ throw — fail fast, lộ ngay ở readiness).
- Root layout (server component, vốn đã render động vì CSP nonce — ADR-084) truyền object đã lọc **chỉ gồm giá trị công khai** xuống client component `RuntimeConfigBoot` qua props. `RuntimeConfigBoot` ghi vào store module của `shared/config` một lần, **trước** khi render con ⇒ `http` client và socket (code không phải React) đọc đồng bộ qua `getRuntimeConfig()`. Gọi `getRuntimeConfig()` trước khi boot ⇒ throw (lỗi lập trình, không im lặng dùng mặc định).
- Không có secret nào ở web (ADR-026): server-env schema chỉ khai báo khóa công khai; test khẳng định object truyền xuống client đúng bằng tập khóa đó.
- Cùng giá trị `API_URL`/`WS_URL` được `proxy.ts` dùng để dựng `connect-src` của CSP lúc chạy (`WS_URL` đổi `http(s)` → `ws(s)`).

**CSP nonce trong `proxy.ts`** (security §6.2, ADR-084; cơ chế đã kiểm — V2, nextjs.org/docs/app/guides/content-security-policy):
- **Policy và header là của security.md §6.8 (W-CSP-1..4) — nguồn sự thật, không chép lại ở đây** để tránh lệch. FE chỉ thêm cách hiện thực.
- Nonce mỗi request: **16 byte từ `crypto.getRandomValues(new Uint8Array(16))` → base64** (128 bit, đạt W-CSP-1). **Không** dùng mẫu trong docs Next `Buffer.from(crypto.randomUUID()).toString('base64')`: UUID v4 chỉ có 122 bit ngẫu nhiên, dưới ngưỡng ≥ 128 bit của W-CSP-1.
- `connect-src` dựng từ host của `API_URL`/`WS_URL` lúc chạy (`https://{API_HOST} wss://{API_HOST}`, không wildcard); dev nới theo W-CSP-3. Header W-CSP-4 (`nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS chỉ prod) đặt cùng chỗ trong `proxy.ts`.
- Gắn `x-nonce` + `Content-Security-Policy` vào **request headers** (`NextResponse.next({ request: { headers } })`) để Next tự đọc nonce và gắn cho script framework, bundle trang và script/style inline nó sinh ra; đặt cùng CSP lên **response**. Server component đọc nonce bằng `(await headers()).get('x-nonce')` (script chọn theme, mục 6.1).
- Hệ quả: mọi trang render động (static/ISR tắt, PPR không dùng được) — đã chấp nhận ở ADR-084. Không dùng SRI experimental (`experimental.sri`) vì đã đi đường nonce.
- `matcher` của proxy bỏ qua `_next/static`, `_next/image`, `favicon.ico` (không cần nonce cho file tĩnh).
- Test: unit test hàm dựng CSP (nonce 16 byte, đủ directive W-CSP-2, prod không có `unsafe-inline`/`unsafe-eval`, dev có nới W-CSP-3); E2E kiểm header trên build prod (khớp checklist devops §8 mục 8).
- Dev local: `.env.local` của `apps/web` có `API_URL=http://localhost:4000/api/v1`, `WS_URL=http://localhost:4000` (không tiền tố `NEXT_PUBLIC_`).

---

## 4. Kanban & đồng bộ realtime

### 4.1. Cây component & ngân sách

```
views/board/ui/BoardPage.tsx                 (~60 dòng) đọc params, useBoardRealtime, layout
└─ widgets/board-toolbar                      bộ lọc + nút tạo
└─ widgets/kanban-board
   ├─ ui/KanbanBoard.tsx                      (~120) DragDropProvider, sensors, plugins (Accessibility vi), 4 cột
   ├─ ui/BoardColumn.tsx                      (~90)  useDroppable (cột, disabled theo state machine) + danh sách
   ├─ ui/SortableTaskCard.tsx                 (~50)  useSortable({ id, index, group: status }) bọc entities/task TaskCard
   ├─ ui/BoardDragOverlay.tsx                 (~30)  DragOverlay
   ├─ model/a11y-announcements.ts             chuỗi tiếng Việt cho Accessibility plugin
   ├─ ui/ArchivedBanner.tsx                   (~30)
   ├─ model/use-board-columns.ts              cột suy ra từ cache + filter + preview kéo
   ├─ model/drag-reducer.ts                   state kéo tạm (activeId, overStatus, overIndex)
   └─ model/use-board-dnd.ts                  onDragStart/Over/End/Cancel → computeMoveIntent → mutate
└─ widgets/task-detail-drawer                 mở theo ?task=
```

### 4.2. Kéo thả (dnd-kit)

Thư viện (ADR-060, stack-versions §3): **`@dnd-kit/react` 0.5.0 + `@dnd-kit/helpers` 0.5.0 + `@dnd-kit/dom` 0.5.0** — pin **chính xác** (bản 0.x). `@dnd-kit/dom` phải khai báo trực tiếp trong `apps/web/package.json` vì ta import `Accessibility` từ đó (pnpm không cho import gói gián tiếp). Phương án dự phòng nếu 0.x gặp lỗi chặn: `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 (thiết kế dưới đây không đổi, chỉ đổi lớp `widgets/kanban-board`).

API đã kiểm chứng trên `.d.ts` 0.5.0 và dndkit.com (V6):

| Nhu cầu | API |
|---|---|
| Provider | `DragDropProvider` (`@dnd-kit/react`) với `onDragStart`, `onDragOver`, `onDragEnd`, `onBeforeDragStart` |
| Thẻ sắp xếp được giữa nhiều cột | `useSortable({ id, index, group: status, disabled })` từ `@dnd-kit/react/sortable` |
| Cột (kể cả rỗng) | `useDroppable({ id: status, disabled })` |
| Di chuyển phần tử giữa các danh sách | `move(items, event)` từ `@dnd-kit/helpers` — nhận `Record<status, id[]>` |
| Bàn phím | `KeyboardSensor` **có sẵn** trong preset mặc định (cùng `PointerSensor`): nhấc Space/Enter, hủy Escape, thả Space/Enter/Tab |
| Cấu hình sensor | prop `sensors={(defaults) => [...]}`; `PointerSensor.configure(...)`, `KeyboardSensor.configure({ keyboardCodes, offset, preventActivation })` |
| Screen reader | `plugins={(defaults) => [...defaults, Accessibility.configure({ announcements, screenReaderInstructions })]}` (`Accessibility` từ `@dnd-kit/dom`) |
| Overlay | `DragOverlay` (`dropAnimation={null}` khi `prefers-reduced-motion`) |
| Hủy | `onDragEnd` có `event.canceled`; `event.preventDefault()` dùng được ở `onBeforeDragStart` và `onDragOver` (không ở `dragstart`) |

**Sensors**: Pointer với ràng buộc kích hoạt khoảng cách ~5px để click vẫn mở drawer (cấu hình qua `PointerSensor.configure(...)`; **tên option ràng buộc kích hoạt chưa kiểm ở T-005b** — tra `.d.ts` 0.5.0 khi code, không đoán; viết test E2E click-mở-drawer để khóa hành vi). Bàn phím dùng mặc định.

**Trong lúc kéo**: không ghi vào Query cache. `onDragStart` chụp `preview = Record<status, id[]>` từ cột hiện tại; `onDragOver` áp `move(preview, event)` lên **bản preview cục bộ** (`drag-reducer`); `use-board-columns` render từ preview khi đang kéo, từ cache khi không. Event socket trong lúc kéo vẫn merge vào cache bình thường, không đánh nhau với UI kéo. `onDragEnd`: `event.canceled` ⇒ bỏ preview; ngược lại tính `computeMoveIntent(preview)` rồi bỏ preview và gọi mutation (optimistic ghi vào cache). Task đang kéo đã bị xóa (tombstone) lúc thả ⇒ bỏ qua + toast. Không dùng API dừng kéo theo chương trình (`manager.actions.stop` chỉ có trong types, chưa có tài liệu).

**Cột không cho thả (state machine)**: `allowedTargets(from) = TASK_STATUS_TRANSITIONS[from] ∪ {from}` (`TASK_STATUS_TRANSITIONS` import từ `packages/contracts` — ADR-080; `entities/task/model/transitions.ts` chỉ bọc hàm). Chặn 3 lớp:
1. Cột không hợp lệ: `useDroppable({ disabled: true })`, thẻ trong cột đó `useSortable({ disabled: … })` cho vai trò đích; cột mờ + ⊘ + tooltip "Không thể chuyển từ Cần làm sang Hoàn thành".
2. `onDragOver`: đích thuộc cột không hợp lệ ⇒ `event.preventDefault()` (chặn plugin sắp xếp lạc quan mặc định) và **không** gọi `move` ⇒ preview không đổi.
3. `onDragEnd`: kiểm lại `allowedTargets`; sai ⇒ không gửi request, announcement lý do.

**Accessibility** (WCAG 2.2):
- Announcements tiếng Việt qua `Accessibility.configure({ announcements: { dragstart, dragover, dragend } , screenReaderInstructions: { draggable: 'Nhấn Space để nhấc thẻ, mũi tên để di chuyển, Space để thả, Escape để hủy.' } })`: "Đã nhấc WEB-112 ở cột Cần làm, vị trí 1/12" · "WEB-112 ở cột Đang làm, vị trí 3/5" · "Đã thả…" · "Đã hủy kéo" · "Không thể chuyển sang Hoàn thành".
- **Có đường thay thế không cần kéo** (SC 2.5.7 Dragging Movements): menu "⋯" trên thẻ → "Chuyển tới ▸ [chỉ cột hợp lệ]" (đặt cuối cột), "Lên đầu cột", "Xuống cuối cột"; và Select "Trạng thái" trong drawer. Mọi đường đều đi qua cùng `useMoveTask`.
- Thẻ là phần tử focus được; Enter mở drawer; focus quay về thẻ khi đóng drawer.
- `prefers-reduced-motion` ⇒ tắt animation sắp xếp.

**Ai được kéo**: `can('task:move') && !project.isArchived`. VIEWER/archived: không gắn sensor, không hiện tay kéo, menu "Chuyển tới" ẩn/khóa. Thẻ đang có mutation chạy dở (`pendingTaskIds`) tạm khóa kéo (có spinner nhỏ) — tránh gửi 2 move liên tiếp với cùng `expectedVersion` (sẽ tự 409).

### 4.3. Rank & payload move (đã khớp T-003 §2.7 — không đề xuất đổi)

- Client gửi **`{ expectedVersion, status?, afterId, beforeId }`**, **không gửi rank**. Server tính rank từ DB (ADR-011).
- `computeMoveIntent(columnsAfterDrop, taskId)` (hàm thuần, `features/task-move`):
  - `afterId` = task ngay **trên** vị trí thả trong cột đích (bỏ qua chính nó), `null` nếu thả đầu cột.
  - `beforeId` = task ngay **dưới**, `null` nếu thả cuối cột.
  - `status` chỉ gửi khi khác cột cũ.
  - Vị trí không đổi (cùng cột, cùng hàng xóm) ⇒ không gửi gì.
- **Khi đang lọc** (board-filter), hàng xóm *hiển thị* có thể không phải hàng xóm *thật*. Vẫn gửi theo hàng xóm hiển thị: server đặt task ngay sau `afterId` (giữa `afterId` và task kế tiếp thực tế) — kết quả hợp lý, đúng ngữ nghĩa T-003.
- **Rank tạm cho optimistic**: `generateKeyBetween(after?.rank ?? null, before?.rank ?? null)` (`fractional-indexing`, cùng thư viện với server). Rank hàng xóm lệch do dữ liệu cũ (`after ≥ before`) ⇒ bỏ qua optimistic vị trí, chỉ đổi cột + đặt cuối; server trả rank thật ngay sau đó. ⚠️ **fractional-indexing 4.0.0 KHÔNG ném lỗi** khi `after ≥ before` (`generateKeyBetween('a2','a1')` trả `'a1V'`, nằm ngoài khoảng) — FE phải tự so thứ tự trước khi gọi (`entities/task/model/temp-rank.ts`, đã kiểm ở T-025); thư viện chỉ ném với khóa sai định dạng.
- Sắp xếp: `(a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1` — so sánh code unit, khớp collation "C" với chuỗi ASCII của fractional-indexing; **cấm `localeCompare`**.

### 4.4. Optimistic update & rollback

`useMoveTask` (TanStack `useMutation`, **chữ ký callback từ v5.89** — V5: giá trị trả về của `onMutate` là tham số thứ 3 `onMutateResult`, tham số cuối là `context = { client, meta, mutationKey }`):

```
variables = { taskId, base /* TaskDto lúc thả */, intent: { status?, afterId, beforeId }, tempRank }
mutationFn(v):  PATCH …/move { expectedVersion: v.base.version, ...v.intent }
                // expectedVersion lấy từ LÚC THẢ, không đọc lại cache lúc gửi — đọc lại sẽ
                // "nuốt" thay đổi của người khác vừa đến qua socket (mất phát hiện xung đột)
onMutate(v, ctx):
  await ctx.client.cancelQueries({ queryKey: boardKey })
  ctx.client.setQueryData(boardKey, upsert({ ...v.base, status: to, rank: v.tempRank }))  // KHÔNG tăng version
  pendingTaskIds.add(v.taskId)
  return { base: v.base }
onSuccess(task, v, r, ctx):        mergeIfNewer(task)            // task.version > cached.version ⇒ thay
onError(err, v, r, ctx):           xem bảng (dùng r.base)
onSettled(data, err, v, r, ctx):   pendingTaskIds.delete(v.taskId)
```

Sửa trong drawer (`useUpdateTask`, `useAssignTask`) dùng `scope: { id: 'task:' + taskId }` (có từ v5.31) để các lần lưu liên tiếp của **cùng task** chạy tuần tự; lần sau mang version cũ sẽ 409 với chính lần trước và được rebase 3 chiều (mục 4.6) tự gửi lại — xác định, không phụ thuộc thứ tự mạng. Move không cần `scope` vì thẻ đang chờ đã bị khóa kéo.

**Rollback có điều kiện, theo từng task — không khôi phục snapshot cả board.** Lý do: trong lúc request bay, event socket của người khác có thể đã cập nhật board (kể cả chính task này với version lớn hơn); khôi phục snapshot toàn board sẽ xóa mất các thay đổi đó.

`revert(base)` = nếu `cached.version === base.version` (chưa ai cập nhật task này kể từ lúc kéo) thì đặt lại `base`; ngược lại giữ nguyên bản trong cache (đã mới hơn).

| Lỗi | Hành động | Toast |
|---|---|---|
| `409 VERSION_CONFLICT` | `cur = details.current`. Nếu `cur.status === base.status && cur.rank === base.rank` (người khác chỉ sửa nội dung, không di chuyển) ⇒ **tự gửi lại 1 lần** với `expectedVersion = cur.version` (ý định kéo vẫn hợp lệ). Ngược lại ⇒ `mergeIfNewer(cur)` (task về vị trí thật) | Khi không tự gửi lại: "WEB-112 vừa được {actor} cập nhật — đã hiển thị vị trí mới nhất" |
| `422 INVALID_STATUS_TRANSITION` | `revert(base)` (FE lẽ ra đã chặn ⇒ bảng chuyển trạng thái FE lệch: log cảnh báo) | "Không thể chuyển sang {to}. Được phép: {allowed}" |
| `422 PROJECT_ARCHIVED` | `revert(base)`, invalidate project ⇒ board chỉ đọc | "Dự án đã được lưu trữ" |
| `422 BUSINESS_RULE_VIOLATION` (`INVALID_ANCHOR`) | `revert(base)`, refetch board | "Bảng vừa thay đổi, vui lòng thử lại" |
| `409 RESOURCE_CONFLICT` (trùng rank sau 3 lần) | `revert(base)`, refetch board | như trên |
| `403` | `revert(base)`, invalidate `['ws', wsId]` | "Bạn không có quyền di chuyển task" |
| `404` | xóa task khỏi cache + tombstone | "Task không còn tồn tại" |
| Mạng/5xx | `revert(base)` | "Không lưu được thay đổi. Thử lại?" (nút Thử lại gửi lại cùng intent) |

Cùng mẫu áp dụng cho `useUpdateTask`, `useAssignTask`, `useDeleteTask`. Xóa: ẩn thẻ ngay (optimistic), **có gửi** `expectedVersion`; lỗi ⇒ hiện lại theo `revert`; riêng `409` ⇒ hiện lại thẻ bản mới nhất + dialog "Task vừa được {actor} thay đổi. Vẫn xóa?" (đồng ý ⇒ gửi lại với version mới) — tránh xóa mất thay đổi người khác vừa làm mà không biết.

### 4.5. Merge event socket vào cache

`useBoardRealtime(wsId, projectId)` (features/board-realtime):
- Mount: `emit('project:join', { workspaceId, projectId }, ack)`; `ack.ok=false, code=RESOURCE_NOT_FOUND` ⇒ màn Không tìm thấy. Unmount: `project:leave`.
- Lắng nghe `task:created|updated|moved|deleted`, `project:updated` và gọi reducer thuần:

```ts
applyRealtimeEvent(board: BoardData, ev: RealtimeEnvelope, ctx: { myClientId, seen: LruSet, tombstones: Map<id, version> }): BoardData
```

Quy tắc (đúng thứ tự, khớp T-003 §4.4):
1. `seen.has(ev.eventId)` ⇒ bỏ; ngược lại `seen.add` (LRU 500).
2. `ev.originClientId === myClientId` ⇒ bỏ (response REST đã cập nhật cache).
3. `task:deleted` ⇒ nếu `cached` và `cached.version > data.version` thì bỏ (không xảy ra bình thường); xóa khỏi `byId`; `tombstones.set(taskId, version)`.
4. `task:created|updated|moved` với `t = data.task`:
   - `tombstones.get(t.id) >= t.version` ⇒ bỏ (event cũ đến sau xóa).
   - `cached && t.version <= cached.version` ⇒ bỏ (cũ hoặc trùng).
   - còn lại ⇒ `byId[t.id] = t` (giữ nguyên tham chiếu các task khác).
5. `project:updated` ⇒ `setQueryData(projectKey, data.project)`.

Hiệu ứng phụ ngoài reducer: event chạm task đang mở drawer ⇒ invalidate audit của task đó; nếu task đang mở bị xóa ⇒ đóng drawer + toast "Task vừa bị {actor} xóa"; nếu đang kéo đúng task bị xóa ⇒ hủy kéo.

**Optimistic + event đến cùng lúc**: cache optimistic giữ **version cũ** (không tăng). Event của người khác cho cùng task có version lớn hơn ⇒ thắng, ghi đè preview; request của mình sau đó 409 và đi theo bảng 4.4. Response của chính mình có `version = base.version + 1` ⇒ thắng bản optimistic. Không cần cờ đặc biệt.

**Reconnect**: socket `connect` lần thứ 2 trở đi ⇒ join lại mọi phòng đang mở ⇒ `invalidateQueries(boardKey)` **một lần** (không có replay ở v1.1). Giữ `tombstones` qua refetch (rẻ, chặn event trễ). Trong lúc đang offline: board vẫn thao tác được (REST độc lập socket), header hiện "Đang kết nối lại…".

**Tab ẩn lâu** (trình duyệt có thể treo socket): khi `visibilitychange → visible` mà socket không `connected` ⇒ ép `connect()`; đã kết nối lại ⇒ theo quy tắc reconnect.

### 4.6. Hòa giải 409 khi sửa trong drawer (`features/task-edit`)

Rủi ro T-003 đã nêu: move của người khác cũng tăng version ⇒ người đang sửa tiêu đề sẽ gặp 409 dù không ai đụng tiêu đề. Giải bằng **rebase 3 chiều**:
- `base` = task lúc bắt đầu sửa (form `defaultValues`), `mine` = các field người dùng đã sửa (dirty), `theirs` = `details.current`.
- Với mỗi field dirty: `theirs[f] === base[f]` ⇒ không xung đột.
- Không xung đột field nào ⇒ **tự gửi lại 1 lần** với `expectedVersion = theirs.version` (người dùng không thấy gì).
- Có xung đột ⇒ hiện khối vàng (wireframe 1.5): **Xem bản mới nhất** (so sánh 2 giá trị) · **Giữ bản của tôi** (gửi lại với version mới — ghi đè có chủ đích) · **Bỏ thay đổi của tôi** (reset form về `theirs`).
- Khi drawer mở và event socket cập nhật task: field không dirty ⇒ cập nhật hiển thị ngay; field đang dirty ⇒ giữ giá trị người dùng, gắn chấm "đã thay đổi bởi người khác".

### 4.7. Hiệu năng — mục tiêu 500 task

Ngân sách: board 500 task (4 cột) render lần đầu < 300ms trên laptop trung bình (CPU throttle 4× trong DevTools ≈ máy yếu); kéo ổn định ≥ 50 fps; merge 1 event < 4ms.

Biện pháp (theo thứ tự, chỉ leo bậc khi đo thấy thiếu):
1. Chuẩn hóa `byId` + giữ tham chiếu; `React.memo(TaskCard)` so sánh `task` (tham chiếu) + vài prop nguyên thủy; callback ổn định (`useCallback`, hoặc truyền `taskId` thay closure).
2. `BoardColumn` memo theo mảng id (so sánh nông); **đo** bằng React Profiler xem `useSortable` của @dnd-kit/react có render lại mọi thẻ cùng `group` khi kéo không; nếu có, tách phần tử kéo bằng `DragOverlay` và giữ thẻ gốc tĩnh.
3. Cột **Hoàn thành** mặc định hiện 50 thẻ đầu + "Hiện thêm" (cột tích lũy lớn nhất, ít khi kéo).
4. Bậc cuối: ảo hóa cột (`@tanstack/react-virtual`) khi cột > 150 thẻ. Ảo hóa xung đột với sortable (item chưa mount không đo được) ⇒ chỉ làm nếu bước 1–3 không đạt, ước lượng +3 ngày.
5. Không parse Zod danh sách 500 task ở prod nếu đo thấy > 10ms.
6. React Compiler: stable nhưng tắt mặc định ở Next 16.4 (stack-versions §3). **Không bật ở Phase 4**; chỉ xem xét nếu bước 1–3 không đạt và đo thấy có lợi.

Kiểm chứng: test hiệu năng Playwright (mục 8.4) với 500 task seed.

---

## 5. Ẩn/hiện theo quyền — `usePermission()`

```ts
// Bảng quyền KHÔNG viết lại ở FE — import từ contracts (ADR-080: dữ liệu thuần, parity test với domain API)
import { ROLE_PERMISSIONS, type Permission, type WorkspaceRole } from '@taskflow/contracts';

// entities/workspace/model/use-permission.ts
function usePermission(): {
  role: WorkspaceRole | null;          // null khi đang tải ⇒ mọi can() = false (an toàn: ẩn trước, hiện sau)
  can(p: Permission): boolean;
  viewerId: string;
}
```

- Workspace hiện tại lấy từ `useParams().wsId`; role từ `['ws', wsId].myRole` (cập nhật realtime qua `member:role-changed`, mục 3.5).
- Luật cần ngữ cảnh tài nguyên là **hàm thuần** trong `entities/task/model/policy.ts`, nhận `can`, `viewerId`, `task`:
  - `canDeleteTask = can('task:delete:any') || (can('task:delete:own') && task.createdBy?.id === viewerId)`
  - `canAssignTask(target)` = `:any` ⇒ true; `:own` ⇒ task do mình tạo, hoặc tự nhận khi `assignee === null && target === viewerId`, hoặc tự bỏ khi `assignee.id === viewerId && target === null` (ADR-041). Khi **tạo** task, MEMBER chỉ được để trống hoặc tự gán.
  - Người nhận (`target ≠ null`) phải có role ≥ MEMBER (ADR-044): picker chỉ liệt kê `useAssignableMembers`; VIEWER không có nút "Nhận việc". Server vẫn là chốt chặn (`422 ASSIGNEE_NOT_MEMBER` ⇒ toast + refetch picker).
  - `canEditBoard = can('task:update') && !project.isArchived`.
- Thành viên: `canChangeRole = can('member:update-role')`; `rolesAssignable` = OWNER: cả 4, PM: MEMBER/VIEWER; `canRemove(member)` theo security §3.2.
- Quy ước hiển thị: **không bao giờ** có quyền theo role ⇒ **ẩn**; có quyền nhưng ngữ cảnh chặn (archived) ⇒ **khóa + tooltip lý do**.
- **UI không phải lớp bảo vệ**: mọi lỗi 403 vẫn xử lý êm (mục 3.4). Không có test FE nào thay thế được SEC-05…SEC-14 phía API.
- `ROLE_PERMISSIONS` và `TASK_STATUS_TRANSITIONS` lấy từ `packages/contracts` (ADR-080); parity với domain do CI của `apps/api` kiểm. FE không giữ bản sao.

---

## 6. Design system tối thiểu

### 6.1. Token (CSS variables, Tailwind đọc từ biến)

Tailwind 4.3.3, cấu hình CSS-first, **không có `tailwind.config.*`** (stack-versions §3, V4). Cách nối, trong `src/app/styles/globals.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));   /* V4: tailwindcss.com/docs/dark-mode */

:root               { --surface: #FFFFFF; --text: #14161B; /* … bảng dưới, cột Sáng */ }
[data-theme=dark]   { --surface: #1A1E27; --text: #E8EAEE; /* … cột Tối */ }

@theme inline {                      /* utility `bg-surface`, `text-text`… đọc biến ngữ nghĩa ở trên */
  --color-surface: var(--surface);
  --color-text: var(--text);
  --font-sans: var(--font-inter);    /* biến do next/font sinh */
}
```

Biến ngữ nghĩa (`--surface`) đổi theo theme; token Tailwind (`--color-surface`) chỉ tham chiếu nên dùng `@theme inline` (V4: tailwindcss.com/docs/theme). **Không** override trực tiếp `--color-*` theo theme (giá trị `inline` đã được nhúng vào utility nên override sẽ không có tác dụng). Cách ghép "biến ngữ nghĩa + `@theme inline`" là suy luận từ docs (docs không có ví dụ dark mode cho trường hợp này) ⇒ T-012 phải có smoke test: đổi `data-theme` thì màu `bg-surface` đổi.

| Token | Sáng | Tối | Dùng cho |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#0B0D12` | nền trang |
| `--bg-subtle` | `#F5F6F8` | `#12151C` | nền cột, sidebar |
| `--surface` | `#FFFFFF` | `#1A1E27` | thẻ, drawer, dialog |
| `--border` | `#E3E5EA` | `#2A2F3A` | viền |
| `--text` | `#14161B` | `#E8EAEE` | chữ chính |
| `--text-muted` | `#5B6170` | `#9AA1B0` | chữ phụ |
| `--primary` / `--primary-fg` | `#2F5BEA` / `#FFFFFF` | `#6E8EFF` / `#0B0D12` | nút chính, focus |
| `--danger` | `#C62828` | `#FF6B6B` | xóa, lỗi |
| `--warning` | `#B26A00` | `#FFB547` | quá hạn, archived |
| `--success` | `#1E7F4F` | `#4CC38A` | kết nối OK |
| `--focus-ring` | `#2F5BEA` 2px + offset 2px | `#6E8EFF` | mọi phần tử focus |
| `--priority-low/medium/high/urgent` | xám `#6B7280` / xanh `#2563EB` / cam `#C2410C` / đỏ `#B91C1C` | tương ứng sáng hơn | Badge ưu tiên (**luôn kèm icon + chữ**, không chỉ màu) |

Mọi cặp chữ/nền phải đạt WCAG AA (4.5:1 chữ thường) — kiểm tự động bằng axe trong E2E (mục 8). Giá trị trên là điểm xuất phát, chỉnh khi axe báo.

Chế độ tối: người dùng chọn Sáng/Tối/Hệ thống (lưu localStorage — không nhạy cảm). Script nhỏ chạy trước khi paint (inline, có nonce lấy từ `(await headers()).get('x-nonce')` ở root layout — V2) **luôn** đặt `data-theme="light|dark"` lên `<html>`; chế độ Hệ thống thì tính từ `prefers-color-scheme` và nghe `change`. Một cơ chế duy nhất (`data-theme`) cho cả variant `dark:` lẫn biến CSS.

### 6.2. Typography & khoảng cách

- Font: **Inter** qua `next/font/google`: `Inter({ subsets: ['latin', 'vietnamese'], variable: '--font-inter', display: 'swap' })`. Đã kiểm (V3): Inter có subset `vietnamese` (font-data.json của Next); CSS + file font **tải lúc build và tự host**, trình duyệt không gửi request tới Google — hợp CSP, không lộ IP người dùng. ⚠️ Build cần mạng ra Google Fonts (CI/Docker build stage).
- Thang chữ: 12 / 14 (mặc định UI) / 16 / 20 / 24 px; `line-height` ≥ 1.5 cho chữ thân (dấu tiếng Việt chồng tầng cần khoảng thở). Đậm: 400/500/600.
- **Khung ngang (container) — một cho cả khu đã đăng nhập:** `PAGE_CONTAINER` = `mx-auto w-full max-w-7xl px-4 sm:px-6` (`shared/ui/page`), dùng cho `AppHeader` và mọi màn qua `PageMain` ⇒ logo, tiêu đề màn và cột đầu của board thẳng một mép trái ở 360/768/1440 (mép 16 / 24 / 104 px). Màn form giới hạn bề ngang nội dung (`PageMain className="max-w-3xl …"`) nhưng **căn trái** trong khung, không `mx-auto` riêng. Board: vùng cuộn ngang tràn ra lề khung (`-mx-4 px-4 sm:-mx-6 sm:px-6`) để cột cuộn tới sát mép màn trên mobile; trang không bao giờ cuộn ngang. Ngoại lệ: màn khách (`AuthCard`, landing) và khối lỗi/404 toàn màn (`max-w-md` căn giữa).
- Khoảng cách: thang 4px (4, 8, 12, 16, 24, 32, 48). Bo góc: 6px (input, nút), 10px (thẻ, dialog). Bóng: 2 mức (thẻ, nổi khi kéo).
- Ngày: `Intl.DateTimeFormat('vi-VN')` → `15/10/2026`; thời gian tương đối "2 phút trước" bằng `Intl.RelativeTimeFormat('vi')`. `dueDate` là chuỗi `YYYY-MM-DD` — **không** `new Date('YYYY-MM-DD')` (bị hiểu là UTC); so quá hạn bằng so sánh chuỗi với ngày hôm nay theo giờ địa phương (`shared/lib/date-only.ts`).

### 6.3. Component `shared/ui`

Danh sách **đúng với code** (`apps/web/src/shared/ui/`, G2 F2). Màn mới dùng những gì có ở đây; cần primitive mới ⇒ thêm vào `shared/ui` kèm test, cập nhật bảng.

| Component | Ghi chú |
|---|---|
| `Button` | variant primary/secondary/ghost/danger, size, `loading`, `asChild` (bọc `Link`) |
| `Input` (+ `controlClass`) · `Textarea` · `Select` | label + hint + lỗi gắn `aria-describedby` có sẵn trong từng control (không có `Field` riêng); `Select` là `<select>` gốc |
| `Combobox` | picker có tìm (người phụ trách) |
| `ClientForm` | `<form method="post">` khóa mọi ô tới khi hydrate (không submit GET gốc đưa mật khẩu lên URL — T-029) |
| `Alert` · `AuthCard` | khối thông báo theo tone · khung màn khách (một `main`, một `h1`) |
| `Avatar` · `Badge` · `ConnectionDot` | |
| `Dialog` (+ `DialogClose`) · `Drawer` · `DropdownMenu` | Radix (6.4) |
| `Toast` (`toast()`, `Toaster`) · `Skeleton` · `Spinner` · `EmptyState` | |
| `PageMain` · `PAGE_CONTAINER` | khung ngang chung của khu đã đăng nhập (6.2) |

Không có — dùng thay thế:

| Trong bản thiết kế cũ | Dùng thay |
|---|---|
| `ConfirmDialog` | `Dialog` + `footer` (Hủy = `DialogClose`, nút hành động `variant="danger"`) — vd `features/workspace-delete` |
| `ErrorState` | `EmptyState` + nút "Thử lại" (`refetch`) |
| `Banner` | `Alert`, hoặc khối viền trái `border-l-4` (board lưu trữ — `widgets/board-toolbar`) |
| `DatePicker` | `Input type="date"` gốc (`features/task-edit/ui/edit-task-form.tsx`) |
| `Tabs` | danh sách link có `aria-current="page"` (`widgets/settings-tabs`, tab lưu trữ ở danh sách dự án) |
| `Field`, `Checkbox`, `IconButton`, `Tooltip`, `Popover` | chưa màn nào cần: label/lỗi nằm trong control; nút chỉ có icon = `Button variant="ghost"` + `aria-label`; giải thích ngắn = thuộc tính `title`/text hint |

### 6.4. Headless library — ĐỀ XUẤT: **Radix primitives, theo cách shadcn/ui (copy code vào repo)**

| Phương án | Ưu | Nhược |
|---|---|---|
| Tự viết hết | Không phụ thuộc | Dialog/Menu/Combobox đúng a11y (focus trap, phím, ARIA, portal) rất tốn công và dễ sai |
| **Radix + mẫu shadcn/ui** | A11y đã kiểm chứng; code nằm trong repo nên sửa được, áp được token của ta; không khóa vào theme runtime | Phải chia nhỏ file để tuân 150 dòng (vd DropdownMenu tách `menu-content.tsx`, `menu-item.tsx`); theo dõi cập nhật thủ công |
| React Aria (Adobe) | A11y rất mạnh, có i18n | API hook dài dòng hơn; ít mẫu sẵn cho Tailwind |
| MUI/Ant | Đầy đủ | Nặng, theme runtime, khó ép design token, khó giữ 150 dòng khi tùy biến |

Lý do chọn: drawer/dialog/menu/combobox là phần a11y khó nhất của app này; Radix giải nó, còn shadcn cho mẫu Tailwind sẵn mà code vẫn là của ta. Toast dùng `sonner` (mẫu shadcn dùng). Đã kiểm (V8): dùng **gói gộp `radix-ui` 1.8.1** (peer react `^16.8–^19`) — shadcn/ui đã chuyển sang gói này (changelog 2026-02), không dùng `@radix-ui/react-*`; **`sonner` 2.0.8** (peer react `^18 || ^19`). Pin chính xác qua `catalog:`; phiên bản cuối do T-012 chạy `npm view` lại lúc cài (tôn trọng `minimumReleaseAge`). Radix chỉ được import trong `shared/ui` (luật 2.3-5) ⇒ thay thư viện sau này chỉ đụng 1 layer.

---

## 7. Form & validation

### 7.1. Thư viện — ĐỀ XUẤT: **react-hook-form + `@hookform/resolvers` (zodResolver)**

- Uncontrolled ⇒ không render lại cả form mỗi phím gõ; state form nằm ngoài `useState` ⇒ dễ giữ luật ≤ 3 `useState`.
- `zodResolver` dùng thẳng schema `packages/contracts` ⇒ FE và BE cùng một luật (title 3–150, password 12–256 ký tự theo ADR-049/065, keyPrefix regex, slug R19…).
- Phương án khác: TanStack Form (trẻ hơn, ít mẫu) · tự viết (không đáng).
- Đã kiểm (V7a): **`react-hook-form` 7.90.0**, **`@hookform/resolvers` 5.9.1** (peer `zod ^3.25 || ^4`, `react-hook-form ^7.55`; hỗ trợ Zod 4 từ 5.1.0). `zodResolver` từ `@hookform/resolvers/zod`. Schema có `.trim()`/transform ⇒ giá trị submit phải là kiểu **output** của schema (sau trim/transform), không phải kiểu input. Cách khai generic tương ứng của `useForm` chưa kiểm ở T-005b — tra `.d.ts` khi code; T-012 viết 1 test kiểu (`expectTypeOf`) khóa hành vi này.

### 7.2. Dùng schema contracts

- Form dùng schema Body trực tiếp khi khớp 1-1 (`LoginBody`, `RegisterBody`, `CreateProjectBody`, `AddMemberBody`).
- Khi giá trị form khác body (vd `dueDate` input rỗng `''` ⇒ body `undefined`/`null`; `expectedVersion` không phải field người dùng): định nghĩa **schema form** trong `features/*/model/form-schema.ts` bằng cách *dẫn xuất* từ contracts (`CreateTaskBody.pick(...)`/`.extend(...)` — không viết lại luật), kèm hàm `toBody(values, ctx)`.
- Thông báo lỗi tiếng Việt: contracts không chứa nhãn UI (T-003 §5.3). Zod 4 **có** locale `vi` (V7b, zod.dev/error-customization). FE gọi một lần khi khởi động client (`src/app/providers`): `import { vi } from 'zod/locales'; z.config(vi());` (cú pháp đúng như docs). API bật cùng locale (ADR-081) ⇒ `fieldErrors` từ server cũng tiếng Việt, nhất quán với FE. Thông báo riêng cho vài luật nghiệp vụ (vd "Mật khẩu quá phổ biến") đến từ server; FE không dịch lại.
- Mật khẩu: luật độ dài ở client; danh sách mật khẩu phổ biến **chỉ ở server** (không tải 10k mục xuống trình duyệt) ⇒ lỗi về qua `VALIDATION_ERROR.fieldErrors.password`.

### 7.3. Hiển thị lỗi server theo field

`applyServerErrors(form, apiError)` (`shared/lib/form-errors.ts`, nhận interface `setError` tối thiểu để `shared` không phụ thuộc react-hook-form ở kiểu cứng):

| `error.code` | Ánh xạ |
|---|---|
| `VALIDATION_ERROR` | `details.fieldErrors[f][0]` ⇒ `setError(f)`; `formErrors` ⇒ lỗi gốc của form (`root.server`). ADR-081 nói `details` giữ issue `code` + `path`: nếu contract bổ sung danh sách issue có `path` đầy đủ thì FE ưu tiên nó (đặt lỗi đúng field lồng, vd `path: ['dueDate']`), `fieldErrors` là phương án dự phòng — chờ C chốt dạng `details` |
| `RESOURCE_CONFLICT` có `details.field` | `setError(details.field, "Giá trị đã tồn tại")` (slug, keyPrefix) |
| `EMAIL_ALREADY_EXISTS` | `setError('email')` |
| `INVALID_CURRENT_PASSWORD` | `setError('currentPassword')` |
| `INVALID_CREDENTIALS` | lỗi gốc, không gắn field (không lộ trường nào sai) |
| khác | lỗi gốc + mặc định mục 3.4 |

Field không tồn tại trong form (server trả field lạ) ⇒ gộp vào lỗi gốc, không nuốt. Focus tự chuyển tới field lỗi đầu tiên; lỗi gắn `aria-invalid` + `aria-describedby`.

---

## 8. Kế hoạch test FE

Công cụ (ADR-003): **Vitest** (unit + component, môi trường jsdom), **Testing Library**, **MSW** (giả lập HTTP ở tầng mạng), **Playwright** (E2E, chạy API + Postgres + Redis thật qua Docker), `@axe-core/playwright` (a11y). Phiên bản (stack-versions §4 + V11): vitest 5.0.4, `@testing-library/react` 16.3.3, jsdom 30.1.2, `@playwright/test` 1.64.1, **`msw` 3.0.3** (major mới: chỉ ESM, Node ≥ 22.12, TS ≥ 5.9 — ta dùng TS 6.0.3; setup Node vẫn `setupServer` từ `msw/node`; **MSW 3 không còn tự xử lý fake timers** ⇒ test có `vi.useFakeTimers()` phải tự `advanceTimers`), **`@axe-core/playwright` 4.13.0**. Docs MSW chưa ghi rõ tương thích vitest 5/jsdom 30 ⇒ T-012 chạy smoke test 1 handler trước khi viết test thật; lỗi thì báo Tech Lead (dự phòng: msw 2.x).

### 8.1. Unit (logic thuần — ưu tiên số 1, phủ ≥ 90% nhánh)

| Đối tượng | Ca bắt buộc |
|---|---|
| `applyRealtimeEvent` | event mới hơn ghi đè; version bằng/cũ bị bỏ; event của chính mình bị bỏ; trùng `eventId` bị bỏ; `deleted` rồi `updated` cũ đến sau ⇒ không hồi sinh; `created` cho task đã có; tham chiếu task khác giữ nguyên (`toBe`) |
| `computeMoveIntent` | đầu/giữa/cuối cột; cột rỗng; khác cột; không đổi vị trí ⇒ null; đang lọc |
| Sắp xếp rank & rank tạm | so sánh byte vs `localeCompare` (ca chữ hoa/thường), hàng xóm lệch ⇒ fallback |
| `transitions` | toàn bảng 4×4 khớp T-003 §6.1 |
| `permissions` + `policy` | bảng role × permission khớp security §3.2; `canDeleteTask` (own/any/createdBy null); `canAssignTask` 3 nhánh MEMBER |
| `useMoveTask` onError | mỗi dòng bảng 4.4; **revert có điều kiện**: event mới hơn đến giữa chừng thì không bị xóa |
| Rebase 4.6 | không xung đột ⇒ tự gửi lại; xung đột ⇒ trả danh sách field |
| `http` + `refresh` | `TOKEN_EXPIRED` ⇒ refresh + retry đúng 1 lần; 10 request song song ⇒ đúng 1 lần gọi refresh; `UNAUTHORIZED` ⇒ không refresh, `sessionEnded`; `409 REFRESH_IN_PROGRESS` ⇒ chờ + thử lại 1 lần; request xếp hàng khi đang refresh |
| `safe-next-path`, `date-only` | `//evil.com`, `https://…`, `/\evil`; quá hạn theo múi giờ (ép TZ trong test) |
| `applyServerErrors` | đủ bảng 7.3 |
| `runtime-config` / `server-env` | thiếu `API_URL` ⇒ throw; object gửi xuống client chỉ gồm khóa công khai; `getRuntimeConfig()` trước boot ⇒ throw |
| `canAssignTask` + picker | VIEWER không xuất hiện trong danh sách người nhận; MEMBER tạo task chỉ có lựa chọn trống/chính mình |

### 8.2. Component (Testing Library + MSW + socket giả)

- Socket được tiêm qua `RealtimeProvider` với interface `RealtimeClient` ⇒ test dùng `FakeRealtimeClient` có `emitServer(event)`.
- Ca: Login (lỗi field, rate limit đếm ngược) · Register · AuthGate (bootstrap thành công/thất bại/lỗi mạng) · Board render từ MSW, VIEWER không có tay kéo, archived có banner + khóa · menu "Chuyển tới" chỉ liệt kê cột hợp lệ, gọi đúng payload · nhận `task:moved` giả ⇒ thẻ đổi cột · Drawer: sửa + 409 không xung đột (tự lưu) / có xung đột (hiện khối hòa giải) · Thành viên: PM chỉ thấy 2 role, LAST_OWNER toast · `member:role-changed` ⇒ nút ẩn/hiện ngay.
- Kéo thả bằng chuột/bàn phím **không** test trong jsdom (không có layout thật ⇒ dnd-kit không đo được vị trí) — để Playwright.

### 8.3. E2E Playwright (luồng chính, mỗi test tự seed dữ liệu qua API)

| ID | Luồng |
|---|---|
| E2E-01 | Đăng ký → vào board project mặc định → tạo task → task ở cuối Cần làm |
| E2E-02 | Kéo task Cần làm → Đang làm bằng chuột; reload trang ⇒ vẫn đúng cột và thứ tự (refresh token hoạt động sau reload) |
| E2E-03 | Kéo bằng **bàn phím** (Space, mũi tên, Space) |
| E2E-04 | Kéo Cần làm → Hoàn thành ⇒ cột bị chặn, **không** có request PATCH (bắt bằng `page.on('request')`) |
| E2E-05 | **Realtime 2 người**: context A (OWNER) thêm B (MEMBER); B mở cùng board; A kéo task ⇒ B thấy thẻ đổi cột < 1s; B tạo task ⇒ A thấy |
| E2E-06 | **Xung đột**: A và B mở drawer cùng task; A sửa tiêu đề; B sửa tiêu đề ⇒ B thấy khối hòa giải; B sửa mô tả sau khi A chỉ kéo task ⇒ B lưu thành công không thấy gì (tự rebase) |
| E2E-07 | VIEWER: không thấy Tạo task, không kéo được, drawer chỉ đọc |
| E2E-08 | Lưu trữ project khi B đang mở board ⇒ B thấy banner chỉ đọc ngay (`project:updated`) |
| E2E-09 | A xóa B khỏi workspace khi B đang mở board ⇒ B bị đưa về `/w` + toast |
| E2E-10 | Đăng xuất mọi thiết bị ở context A ⇒ context A2 (cùng user) bị đưa về `/login` ở thao tác kế tiếp |
| E2E-11 | Access token hết hạn (API test chạy TTL ngắn qua env) ⇒ thao tác vẫn thành công (refresh trong suốt) |
| E2E-12 | a11y: axe không có vi phạm `serious`/`critical` trên login, board, drawer, thành viên (cả sáng và tối) |
| E2E-13 | Mất mạng giả lập (`context.setOffline`) rồi online ⇒ board tự refetch, thay đổi người khác trong lúc offline xuất hiện |
| E2E-14 | A (OWNER) xóa workspace khi B đang mở board ⇒ B về `/w` + toast; A thấy workspace ở khu "Đã xóa" và khôi phục ⇒ B vào lại được (ADR-047/050) |
| E2E-15 | A hạ B (MEMBER, đang được giao 2 task) xuống VIEWER ⇒ B mất tay kéo ngay, 2 task hiện "Chưa giao" trên board của cả hai (ADR-044) |
| E2E-16 | Cùng image web chạy với `API_URL` khác (2 lần khởi động container trong CI) ⇒ request đi đúng host (ADR-074) |

### 8.4. Hiệu năng

`perf/board-500.spec.ts` (Playwright, Chromium, CPU throttle 4× qua CDP): seed 500 task; đo thời gian từ điều hướng tới khi thẻ cuối xuất hiện (< 300ms sau khi dữ liệu về); ghi trace khi kéo 1 thẻ qua 2 cột, khung > 50ms ⇒ fail. Chạy trong CI hằng đêm (không chặn PR vì nhiễu) — phối hợp T-004.

### 8.5. Cổng CI cho apps/web
`typecheck && lint (ESLint + dependency-cruiser) && vitest && build` chặn PR; Playwright E2E chạy trên PR chạm `apps/web` hoặc `packages/contracts` (theo T-004).

---

## 9. Ước lượng & chia việc Phase 4

Đơn vị: ngày-người (đã gồm test). Giả định Phase 1 đã tạo `apps/web` khung (Next chạy được, ESLint/dependency-cruiser/Vitest cấu hình theo mục 2.4) và Phase 3 đã có API + socket chạy thật.

### 9.0. Gói nền (tuần tự, 1 người, làm trước) — **4 ngày** (T-005b: +1 ngày cho runtime config, `proxy.ts` CSP nonce, locale Zod; phần lớn sẽ làm sớm ở T-012 Phase 1b)

`src/app/providers` (khung), `shared/api` (http + ApiError), `entities/session` (token store, refresh, bootstrap) + `AuthGate`/`GuestGate`, `shared/query`, `shared/config` + `RuntimeConfigBoot` + `server-env` (mục 3.6), `proxy.ts` (CSP nonce), token CSS + font + theme, `shared/ui`: Button, Input, Field, Skeleton, Spinner, Toast. Lý do tuần tự: mọi thứ khác phụ thuộc; làm song song sẽ đụng file.

Kết thúc gói nền: **công bố interface** (chỉ chữ ký + stub trả dữ liệu MSW) cho: `usePermission`, `useWorkspace`, `useAssignableMembers`, `useProject`, `Dialog`, `Drawer`, `DropdownMenu`, `Combobox`, `Tooltip`, `Badge`, `Avatar` — để Gói B làm việc với stub trong khi Gói A làm bản thật.

### 9.1. Gói A — Shell, Auth, Quản trị (người 1) — **≈ 10.5 ngày**

| Phạm vi sở hữu (chỉ người 1 ghi) | Ngày |
|---|---|
| `features/auth-*`, `change-password`, `views/login`, `register`, `account` | 2 |
| `entities/user`, `workspace` (gồm `permissions`, `usePermission`), `member`, `project` | 2 |
| `features/workspace-*` (gồm `workspace-restore`), `member-*`, `project-*`, `profile-edit` | 3 |
| `widgets/app-header`, `project-sidebar`, `member-table`, `project-grid`; `views/workspace-picker`, `workspace-new`, `project-list`, `workspace-settings`, `members`, `project-settings`, `not-found`; `src/app/app-shell.tsx`; route `app/(auth)`, `app/(marketing)`, `app/(app)/w/**` trừ board | 2 |
| `shared/ui`: Dialog, ConfirmDialog, Select, DropdownMenu, Tooltip, Badge, Avatar, Tabs, EmptyState, ErrorState, Banner | 1.5 |

### 9.2. Gói B — Board & Realtime (người 2) — **≈ 12 ngày**

| Phạm vi sở hữu (chỉ người 2 ghi) | Ngày |
|---|---|
| `shared/socket`, `src/app/providers/realtime.tsx`, `features/realtime-session` | 1.5 |
| `entities/task`, `entities/audit-log` | 1.5 |
| `features/board-realtime` (reducer + hook + test) | 1.5 |
| `features/task-move` + `widgets/kanban-board` (dnd, bàn phím, a11y, cột chặn, optimistic/rollback) | 3.5 |
| `features/task-create`, `task-edit` (gồm hòa giải 409), `task-assign`, `task-delete`, `board-filter` | 2.5 |
| `widgets/task-detail-drawer`, `widgets/board-toolbar`, `views/board`, route board | 1 |
| `shared/ui`: Drawer, Popover, Combobox, Textarea, DatePicker, ConnectionDot | 0.5 |

### 9.3. Chống đụng file

- Mỗi slice/thư mục thuộc **đúng một** gói (bảng trên). `shared/ui` chia theo component, **không có barrel chung** (mục 2.2) ⇒ không có file sửa chung.
- `shared/i18n`: mỗi gói file riêng (`vi/auth.ts`, `vi/admin.ts` — A; `vi/task.ts`, `vi/board.ts` — B); `vi/errors.ts` thuộc gói nền, sau đó chỉ A sửa (B gửi yêu cầu).
- `src/app/providers/index.tsx` (ghép provider) thuộc gói nền/A; B chỉ cung cấp `realtime.tsx`, A thêm 1 dòng ghép (đã chừa sẵn ở gói nền).
- Phụ thuộc B → A qua interface công bố ở 9.0; đổi chữ ký ⇒ báo Tech Lead.

### 9.4. Tích hợp & E2E (2 người cùng làm, sau 9.1/9.2) — **≈ 3 ngày**
E2E-01…13, axe, test hiệu năng 500 task, sửa lỗi tích hợp.

**Tổng ≈ 4 + max(10.5, 12) + 3 ≈ 19 ngày lịch** với 2 người (≈ 29.5 ngày-người). Nếu T-012 (Phase 1b) đã làm xong gói nền thì Phase 4 còn ≈ 15 ngày. Đệm rủi ro +20% cho `@dnd-kit/react` 0.x/ảo hóa và CSP nonce (mục 10).

---

## 10. Kiểm chứng phiên bản & API (đã đóng ở T-005b, 2026-10-15)

Nguồn ưu tiên: `docs/research/stack-versions.md` (T-001). Mục nào stack-versions chưa trả lời thì Engineer E tự kiểm trên docs chính thức / `.d.ts` đã publish / npm registry (ghi nguồn bên dưới). Không còn `TODO(T-001)` trong tài liệu này; chỗ còn "chưa kiểm" được ghi rõ là việc của T-012 khi code.

| # | Câu hỏi | Kết luận | Nguồn | Mục |
|---|---|---|---|---|
| V1 | `app/` ở gốc + FSD `src/` | ✅ Next bỏ qua `src/app` khi có `app/` ở gốc. ⚠️ **Cấm `src/pages/`** (build lỗi "pages and app directories should be under the same folder"). `proxy.ts` đặt ở gốc `apps/web/` | nextjs.org/docs/app/api-reference/file-conventions/src-folder · github.com/vercel/next.js `packages/next/src/lib/find-pages-dir.ts` | 2.1 |
| V2 | CSP nonce Next 16 | ✅ `proxy.ts` đặt `x-nonce` + CSP lên request headers, Next tự gắn nonce; **bắt buộc dynamic rendering** (đã chấp nhận ADR-084). SRI là experimental, không dùng | nextjs.org/docs/app/guides/content-security-policy · stack-versions §3 (middleware → proxy) | 3.6 |
| V3 | Font tiếng Việt | ✅ Inter có subset `vietnamese`; tự host lúc build. React 19.3.1; React Compiler không bật | nextjs.org/docs/app/api-reference/components/font · next.js `packages/font/src/google/font-data.json` · stack-versions §3 | 6.2, 4.7 |
| V4 | Tailwind token + dark mode | ✅ 4.3.3 CSS-first, không config JS; `@theme` / `@theme inline`; `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *))`. Ghép biến ngữ nghĩa + `@theme inline` là suy luận ⇒ smoke test ở T-012 | tailwindcss.com/docs/theme · tailwindcss.com/docs/dark-mode · stack-versions §3 | 6.1 |
| V5 | TanStack Query | ✅ 5.104.2; `gcTime`; `scope: { id }` từ 5.31.0; **chữ ký callback mutation đổi từ 5.89.0**: `onMutate(variables, context)`, `onError(error, variables, onMutateResult, context)`… với `context = { client, meta, mutationKey }` | tanstack.com/query/latest/docs/framework/react/reference/useMutation · GitHub releases v5.31.0, v5.89.0 | 3.1, 4.4 |
| V6 | Kéo thả | ✅ `@dnd-kit/react` + `/helpers` + `/dom` 0.5.0 (pin chính xác). `DragDropProvider`, `useSortable({ id, index, group })`, `move()`, KeyboardSensor mặc định, `disabled` trên droppable/sortable, `Accessibility.configure`, `DragOverlay`, `event.canceled`. **Chưa kiểm:** tên option ràng buộc kích hoạt của `PointerSensor` | dndkit.com/react/guides/multiple-sortable-lists · dndkit.com/extend/plugins/accessibility · unpkg.com/@dnd-kit/{react,dom,abstract}@0.5.0/index.d.ts · stack-versions §3 | 4.2 |
| V7 | Form + Zod locale | ✅ `react-hook-form` 7.90.0, `@hookform/resolvers` 5.9.1 (Zod 4 từ 5.1.0); Zod 4 có locale `vi`: `import { vi } from 'zod/locales'; z.config(vi())`. **Chưa kiểm:** cách khai generic output của `useForm` | npm registry · github.com/react-hook-form/resolvers/releases/tag/v5.1.0 · zod.dev/error-customization | 7.1, 7.2 |
| V8 | Headless UI | ✅ gói gộp `radix-ui` 1.8.1 (shadcn đã chuyển sang), `sonner` 2.0.8, cả hai hỗ trợ React 19 | npm registry · ui.shadcn.com/docs/changelog/2026-02-radix-ui | 6.4 |
| V9 | socket.io-client | ✅ 4.8.4; `auth` dạng callback gọi lại mỗi lần reconnect; `err.data` tới được `connect_error`; `transports: ['websocket']` (ADR-074) | socket.io/docs/v4/middlewares · socket.io/docs/v4/client-options · stack-versions §3 | 3.5 |
| V10 | fractional-indexing | ✅ 4.0.0 ESM, `generateKeyBetween(a, b)`, khóa so sánh byte | stack-versions §2 | 4.3 |
| V11 | Tooling test & lint | ✅ dependency-cruiser 18.6.0 hỗ trợ `$1` group matching; ESLint 10 `no-restricted-syntax`/`no-restricted-globals` còn nguyên; `msw` 3.0.3 (ESM, Node ≥ 22.12, TS ≥ 5.9; fake timers tự advance); `@axe-core/playwright` 4.13.0; Playwright 1.64.1; vitest 5.0.4; jsdom 30.1.2. **Chưa kiểm:** MSW 3 × vitest 5/jsdom 30 (docs không nói) ⇒ smoke test T-012 | github.com/sverweij/dependency-cruiser `doc/rules-reference.md` · eslint.org/docs/latest/rules/no-restricted-syntax · github.com/mswjs/msw/releases/tag/v3.0.0 · npm registry · stack-versions §4–5 | 2.4, 8 |
| V12 | Web Locks, BroadcastChannel | ✅ Chrome 69/54, Firefox 96/38, Safari 15.4 — Baseline từ 03/2022; Web Locks chỉ trong secure context | developer.mozilla.org (LockManager/request, BroadcastChannel) · mdn/browser-compat-data | 3.3 |

Cấu hình URL: đã chốt nhận lúc runtime, không dùng `NEXT_PUBLIC_*` (ADR-074) — mục 3.6.

**Rủi ro còn mở cho T-012:** CSP `style-src` theo nonce chặn **thuộc tính `style="…"` trong HTML do server render** (trình duyệt chặn lúc parse; style gán bằng JS qua CSSOM thì không bị chặn). Dashboard render ở client nên ít ảnh hưởng, nhưng landing và shell server-render không được dùng prop `style`. Nếu thư viện nào (Radix portal, `next/font`) cần, T-012 đo trên build prod và báo Tech Lead trước khi nới CSP (vd `style-src-attr`).

### 10.1. Kiểm chứng khi code (T-019, T-025)

| # | Điểm | Kết luận (đã chạy thử, không suy đoán) | Nơi dùng |
|---|---|---|---|
| V13 | MSW 3.0.3 × vitest 5 × jsdom 30 | Chạy tốt. `onUnhandledRequest` đã đổi tên thành **`onUnhandledFrame`** — tên cũ bị bỏ qua âm thầm khi chạy, chỉ `tsc` bắt được. MSW 3 **không giữ cookie** của response giả (`Set-Cookie` vẫn đọc được) ⇒ test dùng cookie jar nhỏ (`test/mock-api.ts`). (T-019) | `test/mock-api.ts` |
| V14 | `PointerSensor` 0.5.0 — ràng buộc kích hoạt (V6 "chưa kiểm") | Mặc định (`PointerSensor.defaults.activationConstraints`): chuột bấm **trên handle** ⇒ không ràng buộc (kéo ngay); ngoài handle ⇒ `Delay 200ms (tol 10)` + `Distance 5`; cảm ứng ⇒ `Delay 250ms (tol 5)`. Board dùng **nút tay kéo riêng** ⇒ click tiêu đề luôn mở drawer, không cần cấu hình sensor. | `widgets/kanban-board` |
| V15 | Plugin `Accessibility` 0.5.0 | Gắn `role="button"`, `tabindex`, `aria-roledescription="draggable"` (tiếng Anh) và `aria-describedby` lên activator **nếu thiếu**. Không có handle ⇒ activator là chính phần tử ⇒ `<article>` thành "button". Cách làm: handle là `<button>` có sẵn `aria-roledescription` tiếng Việt; thẻ không kéo được (VIEWER/lưu trữ) **không gắn ref sortable**. Cấu hình qua `plugins={(defaults) => [...defaults, Accessibility.configure({...})]}` — descriptor sau ghi đè tùy chọn của plugin cùng lớp. | `widgets/kanban-board` |
| V16 | `CollisionPriority` | Chỉ export từ `@dnd-kit/abstract` (gói gián tiếp, pnpm không cho import) ⇒ truyền số (`Low = 1`), `collisionPriority` nhận `number`. | `board-column.tsx` |
| V17 | jsdom + `@dnd-kit/dom` | `@dnd-kit/dom` dùng `ResizeObserver` khi có DOM ⇒ jsdom cần stub (`test/setup-dom.ts`). Server (SSR) tự dùng bản giả (`canUseDOM = false`) ⇒ không ảnh hưởng build. | `vitest.config.ts` |
| V18 | TanStack Query `setQueryData` | Structural sharing giữ tham chiếu task KHÔNG đổi (memo thẻ hoạt động) nhưng task vừa đổi/được rollback là **bản sao** ⇒ test so bằng giá trị (`toEqual`), không `toBe`. | test `use-move-task` |
| V19 | Memo board 500 task | Đo (jsdom, React dev): mount 500 thẻ ≈ 610–690ms, commit khi 1 event đến ≈ 9ms. Truyền callback **không ổn định** (`onOpen={() => …}`) làm commit 1 event lên ≈ 223ms (mọi thẻ render lại) ⇒ callback xuống board phải `useCallback`/hằng. Bộ test thường khẳng định **số lần render** (tất định: 1 event ⇒ đúng 1 thẻ render lại — `test/board-render-count.test.tsx`); phép đo ms chạy riêng `pnpm --filter @taskflow/web test:perf` (`perf/`), không chặn CI vì phụ thuộc tốc độ máy. | `views/board`, `test/board-render-count.test.tsx`, `perf/board.perf.tsx` |
| V20 | Zod 4 × CSP không `unsafe-eval` | Zod dò `new Function("")` (`allowsEval`) **ngay khi tạo `z.object`** để bật JIT ⇒ mọi trang phát một `securitypolicyviolation` (bị chặn đúng nhưng là nhiễu, SEC-48). Bật `z.config({ jitless: true })` trong `instrumentation-client.ts` — Next 16 nạp file này trước `app-index`/hydrate nên trước mọi schema của contracts. Đã kiểm trên build prod: Lighthouse `inspector-issues` hết CSP ở `/login` và board. Server giữ JIT. | `apps/web/instrumentation-client.ts` |

