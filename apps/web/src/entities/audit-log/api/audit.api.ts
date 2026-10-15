import { AuditLogDto } from '@taskflow/contracts/audit';
import * as z from 'zod';

import { http } from '@/shared/api';

const AuditList = z.array(AuditLogDto);

export type AuditScope = Readonly<{ wsId: string; projectId: string; taskId: string }>;

export const auditApi = {
  /** Mới nhất trước, phân trang cursor (data-and-api §2.7). */
  list: ({ wsId, projectId, taskId }: AuditScope, cursor?: string) =>
    http.request(
      'GET',
      `/workspaces/${encodeURIComponent(wsId)}/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/audit-logs`,
      { schema: AuditList, query: { limit: 20, cursor } },
    ),
};
