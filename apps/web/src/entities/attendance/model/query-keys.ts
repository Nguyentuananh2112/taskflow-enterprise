// Dưới gốc ['ws', wsId] (frontend.md §3.2) ⇒ mất quyền workspace (`forgetWorkspace`) dọn luôn.
export const attendanceKeys = {
  all: (wsId: string) => ['ws', wsId, 'attendance'] as const,
  today: (wsId: string) => ['ws', wsId, 'attendance', 'today'] as const,
  month: (wsId: string, month: string) => ['ws', wsId, 'attendance', 'month', month] as const,
  myEvents: (wsId: string, date: string) => ['ws', wsId, 'attendance', 'events', date] as const,
};
