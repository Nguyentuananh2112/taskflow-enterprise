# T-005 — Báo cáo (Engineer E — Frontend)

## Đã làm
- Viết `docs/design/frontend.md`, đủ 9 mục của ticket, thêm mục 0 (nguyên tắc nền) và mục 10 (những gì cần T-001 xác nhận). Nội dung:
  1. Sitemap 13 route, bảng loading/empty/error cho từng màn, ma trận hành động × role, wireframe ASCII cho board, drawer chi tiết task và màn thành viên.
  2. FSD cụ thể: liệt kê slice và segment, quy tắc import, rule dependency-cruiser và ESLint để máy ép (kể cả rule tự viết `taskflow/max-use-state`).
  3. TanStack Query: bảng query key và staleTime. Auth: token trong bộ nhớ, bootstrap bằng `/auth/refresh`, refresh single-flight trong tab và xuyên tab (Web Locks), xếp hàng request khi đang refresh, xử lý refresh thất bại, đồng bộ đa tab bằng BroadcastChannel. Vòng đời socket (`auth:renew`, `auth:expired`, thu hồi quyền).
  4. Kanban: dnd-kit có bàn phím và a11y, cột bị state machine chặn thì không gửi request, payload `afterId/beforeId`, optimistic với rollback có điều kiện theo từng task, bảng xử lý từng mã lỗi 409/422/403/404, reducer merge socket, hòa giải 409 trong drawer bằng rebase 3 chiều, ngân sách hiệu năng cho 500 task.
  5. `usePermission()` và các policy thuần (`canDeleteTask`, `canAssignTask`).
  6. Design system: token sáng/tối, typography hỗ trợ tiếng Việt, danh sách `shared/ui`, đề xuất Radix theo mẫu shadcn.
  7. Form: react-hook-form + zodResolver dùng schema từ contracts, bảng ánh xạ lỗi server vào field.
  8. Kế hoạch test: unit, component (socket giả), 13 kịch bản E2E Playwright, test hiệu năng.
  9. Chia việc Phase 4: gói nền tuần tự (3 ngày), Gói A shell/auth/quản trị (10 ngày), Gói B board/realtime (12 ngày), tích hợp (3 ngày), tổng khoảng 18 ngày lịch. Có quy tắc chống đụng file.
- Không viết code, không commit.

## File
- `docs/design/frontend.md` (mới)
- `docs/reviews/T-005-report.md` (mới)

## Quyết định tôi tự đưa ra (đánh dấu ĐỀ XUẤT trong tài liệu)
1. URL dùng **id**, không dùng slug (slug đổi được nên link cũ sẽ gãy). Task mở bằng `?task=<taskId>` vì API không có endpoint tra theo key.
2. Chi tiết task hiện trong **drawer phải**, không dùng modal hay trang riêng.
3. Không redirect auth phía server Next. Lý do: cookie refresh host-only trên domain API với `Path=/api/v1/auth`, nên server Next không đọc được.
4. Không dùng Redux/Zustand. Server state để ở TanStack Query, phiên đăng nhập là biến module kết hợp `useSyncExternalStore`.
5. Board cache chuẩn hóa `byId`, cột suy ra từ cache. Board để `staleTime: Infinity` vì socket giữ dữ liệu tươi, và refetch khi reconnect.
6. **Rollback theo từng task, có điều kiện về version**, không khôi phục snapshot cả board. Khôi phục cả board sẽ xóa mất event của người khác đến trong lúc request đang chạy.
7. **Tự gửi lại 1 lần** khi gặp 409 nếu thay đổi của người khác không đụng tới thứ mình đang sửa (move: status và rank không đổi; edit: rebase 3 chiều). Cách này giải rủi ro T-003 đã nêu (move làm tăng version, khiến người đang sửa tiêu đề dính 409).
8. Thẻ đang có mutation chạy dở thì khóa kéo, tránh 2 move liên tiếp cùng `expectedVersion`.
9. `X-Client-Id` giữ trong bộ nhớ, không để trong `sessionStorage`. Khi nhân bản tab, trình duyệt sao chép sessionStorage, hai tab sẽ trùng id và bỏ qua event của nhau.
10. Có đường thay thế không cần kéo (menu "Chuyển tới", lên đầu/xuống cuối cột) để đạt WCAG 2.2 SC 2.5.7.
11. Radix theo mẫu shadcn/ui (copy code vào repo), toast dùng `sonner`, form dùng react-hook-form. Lý do từng lựa chọn ở mục 6.4 và 7.1.
12. `shared/ui` không có barrel chung (mỗi component một `index.ts`) để 2 người làm song song không sửa chung file.
13. Cột "Hoàn thành" mặc định hiện 50 thẻ kèm nút "Hiện thêm". Ảo hóa chỉ làm khi đo thấy chưa đạt ngân sách.
14. Xóa task có gửi `expectedVersion`; gặp 409 thì hỏi lại người dùng "Vẫn xóa?".

## Câu hỏi / đề xuất cho Tech Lead (Hỏi-TL)
1. **Bảng chuyển trạng thái và `ROLE_PERMISSIONS` trong `packages/contracts`** (mở rộng Q3 của T-003). Đề xuất xuất cả hai dưới dạng dữ liệu thuần, có test parity ở `apps/api`; FE import thẳng thay vì giữ bản sao có thể lệch.
2. **Locale tiếng Việt cho Zod ở API**: đề xuất API bật cùng locale `vi` với FE để `fieldErrors` trả về là tiếng Việt và nhất quán (cần T-001 xác nhận Zod 4 có locale `vi`).
3. **Mâu thuẫn giữa T-002 và T-003, cần chốt một bên** (FE đang theo T-003, chủ sở hữu contract):
   - Đường dẫn gán người: security.md §3.4 ghi `PATCH …/t/assign`, data-and-api.md §2.7 ghi `PATCH …/:taskId/assignee`.
   - Xóa task thành công: SEC-07/SEC-08/SEC-09 kỳ vọng `204`, còn T-003 trả `200 { id, version }`.
4. **Thiếu API**: (a) không có endpoint sửa họ tên, nên màn Tài khoản chỉ hiển thị; (b) danh sách thành viên chưa có tham số tìm kiếm `q`, nên picker người phụ trách phải tải hết các trang (chấp nhận được với vài trăm người, nên thêm ở bản sau).
5. **CSP nonce** (security §6.2) buộc các trang Next render động. Cần T-001/T-004 xác nhận cơ chế ở Next 16 và tác động tới cache/CDN.
6. **`NEXT_PUBLIC_*` nhúng lúc build**, nên mỗi môi trường cần một image riêng, hoặc chuyển sang cấu hình runtime. Cần T-004 quyết.

## Rủi ro
- **Phiên bản thư viện chưa kiểm chứng**: `docs/research/stack-versions.md` chưa có. Tôi không đoán API, mọi điểm phụ thuộc phiên bản đánh dấu `TODO(T-001)` và gom ở mục 10 (V1–V11). Nếu kết quả khác (vd dnd-kit chọn `@dnd-kit/react`), mục 4.2 chỉ đổi cách gọi, không đổi thiết kế.
- **Hiệu năng dnd-kit với 500 task**: `useSortable` có thể render lại toàn bộ item trong lúc kéo. Đã có lộ trình 4 bậc và test đo. Nếu phải ảo hóa thì tốn thêm khoảng 3 ngày.
- **Không có replay event** ở v1.1, nên reconnect phải refetch cả board. Với 500 task mỗi lần reconnect tốn 1 request khoảng vài trăm KB, chấp nhận được.
- **XSS = mất phiên** (token trong bộ nhớ). Đã cấm `dangerouslySetInnerHTML` bằng lint, mô tả task render dạng text thuần, không có script bên thứ ba. CSP thuộc ticket Phase 4.
- Rule ESLint `max-use-state` phải tự viết (khoảng 40 dòng), cần đưa vào Phase 1.

## Tự phản biện (4 vòng)
1. **Đúng contract chưa?** Đã đối chiếu từng payload và event với T-003 §2.7 và §4, cùng luồng auth và socket với T-002 §1.4 và §5. Phát hiện 2 mâu thuẫn T-002/T-003 (câu hỏi 3) và giữ FE theo contract owner.
2. **Rollback có an toàn khi đồng thời không?** Bản nháp đầu khôi phục snapshot cả board, sẽ ghi đè event người khác. Đã sửa thành revert theo task, kèm điều kiện version.
3. **Có chia được cho 2 người không đụng file?** Bản nháp đầu có barrel `shared/ui/index.ts` và `vi.ts` chung, cả hai người đều phải sửa. Đã tách theo component/miền và chỉ định chủ sở hữu cho file ghép provider.
4. **Có đoán API thư viện mới không?** Đã rà lại: mọi tên option cụ thể (gcTime, `auth` dạng hàm, `useDroppable({disabled})`, `z.config` locale, cách cấu hình Tailwind, `next/font`) đều gắn `TODO(T-001)`. Bảng dependency-cruiser có một rule viết regex sai, đã sửa thành mô tả ý định và để cú pháp cho T-001.
