import * as z from 'zod';

import {
  Cursor,
  IsoDateTime,
  Uuid,
  limitQuery,
  multiLineTextOrNull,
  singleLineText,
} from '../common/primitives';

/** R17: tiền tố mã task, bất biến sau khi tạo (D7). */
export const KeyPrefix = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);
export type KeyPrefix = z.infer<typeof KeyPrefix>;

export const ProjectName = singleLineText(1, 100);
export const ProjectDescription = multiLineTextOrNull(2000);

export const ProjectParams = z.object({ wsId: Uuid, projectId: Uuid });
export type ProjectParams = z.infer<typeof ProjectParams>;

export const ListProjectsQuery = z.object({
  archived: z.enum(['false', 'true', 'all']).default('false'),
  cursor: Cursor.optional(),
  limit: limitQuery(100, 50),
});
export type ListProjectsQuery = z.infer<typeof ListProjectsQuery>;

export const CreateProjectBody = z.strictObject({
  name: ProjectName,
  keyPrefix: KeyPrefix,
  description: ProjectDescription.optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

/** keyPrefix bất biến nên không có ở đây; `strictObject` từ chối nếu client gửi. */
export const UpdateProjectBody = z
  .strictObject({ name: ProjectName.optional(), description: ProjectDescription.optional() })
  .refine((b) => b.name !== undefined || b.description !== undefined, {
    error: 'Phải có ít nhất một trường',
  });
export type UpdateProjectBody = z.infer<typeof UpdateProjectBody>;

export const ProjectDto = z.object({
  id: Uuid,
  workspaceId: Uuid,
  name: z.string(),
  keyPrefix: KeyPrefix,
  description: z.string().nullable(),
  isArchived: z.boolean(),
  archivedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectDto = z.infer<typeof ProjectDto>;
