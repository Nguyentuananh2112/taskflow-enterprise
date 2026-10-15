// Chạy TRƯỚC mọi code client của app (Next nạp file này trước app-index/hydrate).
// Thứ tự import có chủ đích: `zod-jitless` PHẢI là import đầu tiên (xem file đó — SEC-48).
import './src/app/config/zod-jitless';

import { initClientSentry } from './src/app/observability/sentry-client';

// T-035: Sentry trình duyệt — cấu hình đọc đồng bộ từ <meta> của root layout; không DSN ⇒ tắt.
initClientSentry();
