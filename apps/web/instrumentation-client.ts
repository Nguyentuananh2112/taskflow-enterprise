// Chạy TRƯỚC mọi code client của app (Next nạp file này trước app-index/hydrate).
// Thứ tự import có chủ đích: `zod-jitless` PHẢI là import đầu tiên (xem file đó — SEC-48).
import './src/app/config/zod-jitless';

import { readSentryMeta } from './src/app/observability/sentry-meta';

// T-035: Sentry trình duyệt — cấu hình đọc đồng bộ từ <meta> của root layout. SDK (~74 kB gzip) chỉ
// được nạp (dynamic import, chunk riêng, không chặn hydrate) khi CÓ DSN; không DSN ⇒ không tải gì.
// Đánh đổi có chủ đích (review E): lỗi xảy ra trước khi chunk SDK tải xong không được báo.
if (typeof document !== 'undefined' && readSentryMeta(document)) {
  void import('./src/app/observability/sentry-client').then(({ initClientSentry }) =>
    initClientSentry(document),
  );
}
