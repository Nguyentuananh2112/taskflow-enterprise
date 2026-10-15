import { applyVietnameseZodLocale } from '@taskflow/contracts/common';
import { getResponse } from 'msw';

import { createMockApi, isMockApiEnabled, type MockApi } from '@/app/mock-api';

// Mock API cho dev (T-019): `APP_MOCK_API=1` + `API_URL=http://localhost:3001/mock-api/v1`.
// Cùng origin với web ⇒ cookie refresh HttpOnly hoạt động như thật, không cần CORS, không cần
// Service Worker (không phải nới CSP worker-src). Tắt cờ / staging / production ⇒ 404.

// Thông báo validate tiếng Việt như API thật (ADR-081) — không phụ thuộc việc layout đã nạp chưa.
applyVietnameseZodLocale();

const store = globalThis as typeof globalThis & { __taskflowMockApi?: MockApi };

async function handle(request: Request): Promise<Response> {
  if (!isMockApiEnabled()) return new Response(null, { status: 404 });
  // Giữ một instance qua HMR để không mất người dùng đã đăng ký mỗi lần sửa code.
  store.__taskflowMockApi ??= createMockApi(`${new URL(request.url).origin}/mock-api/v1`);
  const response = await getResponse(store.__taskflowMockApi.handlers, request);
  return response ?? new Response(null, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
