import { ForbiddenError } from '../../../core/errors';
import type { MembershipSnapshot } from '../domain/membership';
import type { ProjectSnapshot } from '../domain/project';
import {
  roleAllows,
  type ParentPermission,
  type Permission,
  type WorkspaceRole,
} from '../domain/roles';
import type { WorkspaceSnapshot } from '../domain/workspace';
import type { ProjectEventDto, UserSummary } from './ports/collaborators.port';

/**
 * Người gọi trong một workspace — do middleware `loadMembership` dựng (ws chưa xóa, đã là member;
 * không phải ⇒ 404 trước đó). Use case KHÔNG đọc `req`, và mọi truy vấn đều lọc theo
 * `actor.workspaceId` (phòng thủ 2 lớp, ADR-020).
 */
export interface Actor {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
}

/** Đã là member ⇒ thấy được tài nguyên ⇒ thiếu quyền trả 403 không lộ gì thêm (security.md 4.2). */
export function requirePermission(actor: Actor, permission: Permission | ParentPermission): void {
  if (!roleAllows(actor.role, permission)) throw new ForbiddenError(permission);
}

/** Cùng quy tắc chuẩn hóa với `Email` của module auth (trim → NFC → lowercase). */
export function normalizeEmail(raw: string): string {
  return raw.trim().normalize('NFC').toLowerCase();
}

export interface WorkspaceView {
  id: string;
  name: string;
  slug: string;
  myRole: WorkspaceRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeletedWorkspaceView {
  id: string;
  name: string;
  slug: string;
  deletedAt: Date;
  purgeAt: Date;
}

export interface MemberView {
  userId: string;
  email: string;
  fullName: string;
  role: WorkspaceRole;
  joinedAt: Date;
  /** Mốc 6 (ADR-142): URL ký variant 64 khi nguồn có (composition). */
  avatarUrl?: string | null;
}

export interface ProjectView {
  id: string;
  workspaceId: string;
  name: string;
  keyPrefix: string;
  description: string | null;
  isArchived: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toWorkspaceView(ws: WorkspaceSnapshot, myRole: WorkspaceRole): WorkspaceView {
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    myRole,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  };
}

export function toDeletedWorkspaceView(ws: WorkspaceSnapshot): DeletedWorkspaceView {
  if (!ws.deletedAt || !ws.purgeAt) throw new Error(`Workspace ${ws.id} chưa bị xóa`);
  return { id: ws.id, name: ws.name, slug: ws.slug, deletedAt: ws.deletedAt, purgeAt: ws.purgeAt };
}

export function toMemberView(
  m: MembershipSnapshot,
  user: Pick<UserSummary, 'email' | 'fullName' | 'avatarUrl'>,
): MemberView {
  return {
    userId: m.userId,
    email: user.email,
    fullName: user.fullName,
    role: m.role,
    joinedAt: m.joinedAt,
    ...(user.avatarUrl === undefined ? {} : { avatarUrl: user.avatarUrl }),
  };
}

export function toProjectView(p: ProjectSnapshot): ProjectView {
  return {
    id: p.id,
    workspaceId: p.workspaceId,
    name: p.name,
    keyPrefix: p.keyPrefix,
    description: p.description,
    isArchived: p.archivedAt !== null,
    archivedAt: p.archivedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Payload `project:updated` — `ProjectDto` với ngày ISO (gửi qua socket, không qua responder HTTP). */
export function toProjectEventDto(p: ProjectSnapshot): ProjectEventDto {
  const v = toProjectView(p);
  return {
    ...v,
    archivedAt: v.archivedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}
