import * as z from 'zod';

// Chạy TRƯỚC mọi code client của app (Next nạp file này trước app-index/hydrate).
// Zod 4 dò `new Function("")` (allowsEval) NGAY KHI TẠO `z.object` để bật JIT — CSP không có
// `unsafe-eval` chặn đúng, nhưng mỗi trang phát một `securitypolicyviolation` vô hại, che mất vi phạm
// XSS thật khi bật report-to (SEC-48). `jitless` tắt cả phép dò lẫn JIT; phải bật trước khi bất kỳ
// schema nào của @taskflow/contracts được tạo ⇒ không đặt trong AppProviders (module contracts có thể
// đã nạp trước đó). Server (Node, không CSP) giữ JIT.
z.config({ jitless: true });
