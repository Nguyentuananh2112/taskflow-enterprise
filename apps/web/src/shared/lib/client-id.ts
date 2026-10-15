// X-Client-Id theo tab (data-and-api.md §2.1, frontend.md §3.3): sinh MỘT lần khi module nạp,
// giữ trong bộ nhớ. Không dùng sessionStorage — trình duyệt sao chép nó khi nhân bản tab,
// hai tab trùng id sẽ bỏ qua event realtime của nhau. KHÔNG phải thông tin xác thực (security.md §5.2).
const clientId = crypto.randomUUID();

export function getClientId(): string {
  return clientId;
}
