// Mốc 3.5: dưới gốc ['company'] (ADR-139) — đăng xuất / SESSION_REVOKED ⇒ `queryClient.clear()` dọn hết.
export const attendanceKeys = {
  all: () => ['company', 'attendance'] as const,
  today: () => ['company', 'attendance', 'today'] as const,
  month: (month: string) => ['company', 'attendance', 'month', month] as const,
  myEvents: (date: string) => ['company', 'attendance', 'events', date] as const,
};
