// frontend.md §3.2: ['ws', wsId] là gốc của mọi key thuộc workspace và là nguồn của usePermission.
export const workspaceKeys = {
  root: (wsId: string) => ['ws', wsId] as const,
  detail: (wsId: string) => ['ws', wsId] as const,
};
