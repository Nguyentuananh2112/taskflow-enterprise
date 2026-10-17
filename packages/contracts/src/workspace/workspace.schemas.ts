import * as z from 'zod';

import { IsoDateTime, Uuid, singleLineText } from '../common/primitives';
import { WorkspaceRole } from '../rbac/permissions';

/** R19/ADR-094: tên workspace. */
export const WorkspaceName = singleLineText(1, 100);
export type WorkspaceName = z.infer<typeof WorkspaceName>;

/**
 * R19/ADR-094: slug chữ thường/số/gạch nối, 3–50. Không tự lowercase (chữ hoa ⇒ 400).
 * Danh sách slug dành riêng và việc tự sinh slug nằm ở application của API.
 */
export const WorkspaceSlug = z
  .string()
  .min(3)
  .max(50)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export type WorkspaceSlug = z.infer<typeof WorkspaceSlug>;

export const WorkspaceParams = z.object({ wsId: Uuid });
export type WorkspaceParams = z.infer<typeof WorkspaceParams>;

export const CreateWorkspaceBody = z.strictObject({
  name: WorkspaceName,
  slug: WorkspaceSlug.optional(),
});
export type CreateWorkspaceBody = z.infer<typeof CreateWorkspaceBody>;

export const UpdateWorkspaceBody = z
  .strictObject({ name: WorkspaceName.optional(), slug: WorkspaceSlug.optional() })
  .refine((b) => b.name !== undefined || b.slug !== undefined, {
    error: 'Phải có ít nhất một trường',
  });
export type UpdateWorkspaceBody = z.infer<typeof UpdateWorkspaceBody>;

/** Xác nhận xóa bằng cách gõ lại slug; so khớp với slug thật ở application. */
export const DeleteWorkspaceBody = z.strictObject({ confirmSlug: z.string().min(1).max(50) });
export type DeleteWorkspaceBody = z.infer<typeof DeleteWorkspaceBody>;

/** `deleted=true` ⇒ liệt kê workspace đã xóa mềm mà mình là OWNER (ADR-050). */
export const ListWorkspacesQuery = z.object({ deleted: z.literal('true').optional() });
export type ListWorkspacesQuery = z.infer<typeof ListWorkspacesQuery>;

export const WorkspaceDto = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  myRole: WorkspaceRole,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkspaceDto = z.infer<typeof WorkspaceDto>;

export const DeletedWorkspaceDto = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  deletedAt: IsoDateTime,
  purgeAt: IsoDateTime,
});
export type DeletedWorkspaceDto = z.infer<typeof DeletedWorkspaceDto>;
