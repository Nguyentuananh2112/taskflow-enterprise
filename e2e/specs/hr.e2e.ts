import { test } from '../support/fixtures';

// E2E-HR-* (docs/design/test-spec-hr.md §9, T-042). KHUNG viết trước web Mốc 3: mỗi ca `test.fixme`
// có nhãn vé web kích hoạt (T-041a thẻ chấm công + /attendance + chuông, T-041b /leave, T-041c /hr + công
// tắc grant) và bước dự kiến. Thân ca viết khi vé tương ứng có UI (selector theo vai trò/nhãn tiếng Việt,
// không theo class) — đổi `test.fixme` → `test` cùng PR. Dữ liệu dựng qua API công khai (support/api.ts).
// Server luôn METRICS_PORT=0 (playwright.config.ts) — không đụng dev/prod của người dùng ở 3001/4000.

const T041A = 'T-041a';
const T041B = 'T-041b';
const T041C = 'T-041c';

test.fixme(`@main E2E-HR-01 [${T041A}]: thẻ Chấm công ở /projects ⇒ Vào ⇒ Ra; giờ theo serverNow + múi giờ lịch`, () => {
  // 1. Mia đăng nhập, mở /w/:ws/projects ⇒ thẻ "Chấm công" ở đầu trang.
  // 2. Context đặt timezoneId khác (vd America/New_York) ⇒ giờ trên thẻ vẫn theo Asia/Ho_Chi_Minh.
  // 3. Bấm "Vào" ⇒ trạng thái "Đang làm" (PRESENT + inProgress); bấm "Ra" ⇒ trạng thái đổi, có giờ ra.
  // 4. Bấm "Vào" lần 2 ⇒ thông báo đã chấm vào (409 already_checked_in), không lượt mới.
});

test.fixme(`@main E2E-HR-02 [${T041B}]: gửi đơn ⇒ HR thấy chuông realtime ⇒ duyệt ⇒ nhân viên thấy chuông + lịch "Nghỉ phép"`, () => {
  // 1. Hana (HR, context riêng qua openAs) mở /w/:ws/hr. Mia gửi đơn ở /w/:ws/leave.
  // 2. Chuông của Hana +1 trong < 2 s (notification:new), không reload.
  // 3. Hana duyệt ⇒ chuông của Mia +1; /w/:ws/attendance của Mia hiện ô ngày đó "Nghỉ phép".
  // 4. Mia offline (route WebSocket như E2E-13) lúc Hana duyệt ⇒ online lại ⇒ danh sách tải lại vẫn có (bảng bền).
});

test.fixme(`E2E-HR-03 [${T041C}]: OWNER bật "Quản lý nhân sự" cho Mia ⇒ tab của Mia hiện mục HR ngay (member:grants-changed)`, () => {
  // Olivia ở /w/:ws/settings/members bật công tắc của Mia; tab Mia (đang mở /projects) hiện link "Nhân sự" không reload.
});

test.fixme(`E2E-HR-04 [${T041A}]: VIEWER không thấy UI chấm công/nghỉ; gọi API trực tiếp ⇒ 403`, () => {
  // Vic: /projects không có thẻ Chấm công, không có /leave; request check-in qua API ⇒ 403.
});

test.fixme(`E2E-HR-05 [${T041A}]: banner nhắc chưa chấm vào trong ngày làm việc; KHÔNG tự chấm khi đăng nhập`, () => {
  // Đăng nhập ngày làm việc ⇒ banner; reload/đăng nhập lại ⇒ vẫn chưa có lượt IN (API me/today firstIn = null).
});

test.fixme(`E2E-HR-06 [${T041C}]: HR xuất CSV tháng (fetch + Blob, Bearer) ⇒ tên file theo tháng, có BOM`, () => {
  // page.waitForEvent('download') ⇒ suggestedFilename chứa YYYY-MM, nội dung bắt đầu bằng BOM (U+FEFF).
});

test.fixme(`E2E-HR-07 [${T041A}]: a11y lịch tháng — <table> có tiêu đề hàng/cột, trạng thái chữ + biểu tượng (axe 0 serious/critical, sáng + tối)`, () => {
  // Dùng helper axe của a11y.e2e.ts cho /w/:ws/attendance, /leave, /hr.
});

test.fixme(`E2E-HR-08 [${T041B}]: XSS (mở rộng SEC-49) — reason, decisionNote, ghi chú ADJUSTMENT, tên ngày lễ chứa payload ⇒ chỉ text`, () => {
  // Tái dùng arm()/assertInert() của xss.e2e.ts (tách sang support khi viết thân) cho danh sách đơn, chuông, lịch, /hr.
});

test.fixme(`@main E2E-HR-09 [${T041A}]: responsive 360 → 1440 + Firefox cho luồng chính`, () => {
  // Chạy E2E-HR-01/02 trên project mobile (Pixel 7) và firefox (CI=1).
});
