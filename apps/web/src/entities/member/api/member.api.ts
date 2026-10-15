import { MemberDto } from '@taskflow/contracts/workspace';
import * as z from 'zod';

import { http } from '@/shared/api';

const MemberList = z.array(MemberDto);

export const memberApi = {
  /** Một trang thành viên; `q` lọc theo tên/email phía server (ADR-083). */
  list: (wsId: string, params: Readonly<{ q?: string; limit?: number }> = {}) =>
    http.get(`/workspaces/${encodeURIComponent(wsId)}/members`, {
      schema: MemberList,
      query: { q: params.q || undefined, limit: params.limit ?? 50 },
    }),
};
