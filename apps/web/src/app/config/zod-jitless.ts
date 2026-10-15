import * as z from 'zod';

// Module riêng, import ĐẦU TIÊN trong instrumentation-client.ts: import ESM được hoist ⇒ nếu đặt
// `z.config` trong instrumentation-client cùng với import khác (vd @sentry/nextjs), các import đó sẽ
// chạy TRƯỚC. Zod 4 dò `new Function("")` (allowsEval) NGAY KHI TẠO `z.object` để bật JIT — CSP không
// có `unsafe-eval` chặn đúng, nhưng mỗi trang phát một `securitypolicyviolation` vô hại, che mất vi phạm
// XSS thật khi bật report-to (SEC-48). `jitless` tắt cả phép dò lẫn JIT. Server (Node, không CSP) giữ JIT.
z.config({ jitless: true });
