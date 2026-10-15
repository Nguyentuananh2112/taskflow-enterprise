import { ProjectDto } from '@taskflow/contracts/project';
import * as z from 'zod';

import { http } from '@/shared/api';

const ProjectList = z.array(ProjectDto);
const base = (wsId: string) => `/workspaces/${encodeURIComponent(wsId)}/projects`;
const one = (wsId: string, projectId: string) => `${base(wsId)}/${encodeURIComponent(projectId)}`;

export type ProjectListFilter = 'false' | 'true';

export const projectApi = {
  /** Một trang (cursor) — data-and-api §2.6, tối đa 100/trang. */
  list: (wsId: string, archived: ProjectListFilter, cursor?: string) =>
    http.request('GET', base(wsId), {
      schema: ProjectList,
      query: { archived, limit: 100, cursor },
    }),
  get: (wsId: string, projectId: string) => http.get(one(wsId, projectId), { schema: ProjectDto }),
};
