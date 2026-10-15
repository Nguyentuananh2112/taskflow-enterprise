// Query key của task (frontend.md §3.2). Mọi key thuộc workspace bắt đầu bằng ['ws', wsId] ⇒ mất
// quyền chỉ cần removeQueries(['ws', wsId]). Cấm viết mảng tay ở nơi khác.

export const taskKeys = {
  board: (wsId: string, projectId: string) => ['ws', wsId, 'project', projectId, 'board'] as const,
  detail: (wsId: string, projectId: string, taskId: string) =>
    ['ws', wsId, 'project', projectId, 'task', taskId] as const,
};
