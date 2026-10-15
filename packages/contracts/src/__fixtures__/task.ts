// Dữ liệu mẫu dùng chung cho test contracts (không export ra public API).
export const ID = '0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a';
const NOW = '2026-10-15T08:00:00.000Z';

export const sampleTask = {
  id: ID,
  workspaceId: ID,
  projectId: ID,
  number: 101,
  key: 'TF-101',
  title: 'Viết spec',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  rank: 'a0',
  version: 1,
  dueDate: null,
  assignee: { id: ID, fullName: 'Max' },
  createdBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};
