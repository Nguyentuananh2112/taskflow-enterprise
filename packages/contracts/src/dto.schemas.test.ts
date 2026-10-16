import { describe, expect, it } from 'vitest';

import { ID, sampleTask } from './__fixtures__/task';
import {
  AuthExpiredEvent,
  BusinessRuleDetails,
  ChangeMemberRoleResponse,
  DeleteTaskResponse,
  DeletedWorkspaceDto,
  InvalidStatusTransitionDetails,
  LoginResponse,
  MemberDto,
  MemberRoleChangedEvent,
  NotFoundDetails,
  ProjectArchivedDetails,
  ProjectDto,
  ProjectUpdatedEvent,
  RateLimitedDetails,
  RegisterResponse,
  RemoveMemberResponse,
  ResourceConflictDetails,
  TaskDeletedEvent,
  WorkspaceAccessRevokedEvent,
  WorkspaceDto,
} from './index';

const NOW = '2026-10-15T08:00:00.000Z';
const user = { id: ID, email: 'mia@example.test', fullName: 'Mia', createdAt: NOW };
const envelope = { eventId: ID, occurredAt: NOW, actorId: ID, originClientId: null };
const project = {
  id: ID,
  workspaceId: ID,
  name: 'TaskFlow',
  keyPrefix: 'TF',
  description: null,
  isArchived: false,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('DTO auth/workspace/member', () => {
  it('RegisterResponse cần defaultWorkspaceId; LoginResponse thì không', () => {
    const tokens = { accessToken: 'jwt', expiresIn: 900 };
    expect(LoginResponse.safeParse({ ...tokens, user }).success).toBe(true);
    expect(RegisterResponse.safeParse({ ...tokens, user }).success).toBe(false);
    expect(RegisterResponse.safeParse({ ...tokens, user, defaultWorkspaceId: ID }).success).toBe(
      true,
    );
    expect(LoginResponse.safeParse({ ...tokens, expiresIn: 0, user }).success).toBe(false);
  });

  it('WorkspaceDto có myRole hợp lệ; DeletedWorkspaceDto bắt buộc deletedAt/purgeAt', () => {
    const ws = { id: ID, name: 'W', slug: 'w-one', myGrants: [], createdAt: NOW, updatedAt: NOW };
    expect(WorkspaceDto.safeParse({ ...ws, myRole: 'PM' }).success).toBe(true);
    expect(WorkspaceDto.safeParse({ ...ws, myRole: 'ADMIN' }).success).toBe(false);
    const deleted = { id: ID, name: 'W', slug: 'w-one', deletedAt: NOW, purgeAt: NOW };
    expect(DeletedWorkspaceDto.safeParse(deleted).success).toBe(true);
    expect(DeletedWorkspaceDto.safeParse({ ...deleted, purgeAt: null }).success).toBe(false);
  });

  it('ChangeMemberRoleResponse/RemoveMemberResponse: unassignedTaskCount nguyên ≥ 0', () => {
    const member = {
      userId: ID,
      email: 'a@b.vn',
      fullName: 'A',
      role: 'VIEWER',
      grants: [],
      joinedAt: NOW,
    };
    expect(MemberDto.safeParse(member).success).toBe(true);
    expect(ChangeMemberRoleResponse.safeParse({ member, unassignedTaskCount: 3 }).success).toBe(
      true,
    );
    expect(ChangeMemberRoleResponse.safeParse({ member, unassignedTaskCount: -1 }).success).toBe(
      false,
    );
    expect(RemoveMemberResponse.safeParse({ userId: ID, unassignedTaskCount: 1.5 }).success).toBe(
      false,
    );
  });
});

describe('DTO project/task', () => {
  it('ProjectDto: archivedAt null hoặc ISO, keyPrefix đúng R17', () => {
    expect(ProjectDto.safeParse(project).success).toBe(true);
    expect(ProjectDto.safeParse({ ...project, isArchived: true, archivedAt: NOW }).success).toBe(
      true,
    );
    expect(ProjectDto.safeParse({ ...project, keyPrefix: 'tf' }).success).toBe(false);
  });

  it('DeleteTaskResponse = { id, version }', () => {
    expect(DeleteTaskResponse.safeParse({ id: ID, version: 2 }).success).toBe(true);
    expect(DeleteTaskResponse.safeParse({ id: ID }).success).toBe(false);
  });
});

describe('error.details (data-and-api §3.2)', () => {
  it('mỗi code có details đúng hình dạng', () => {
    expect(BusinessRuleDetails.safeParse({ rule: 'LAST_OWNER' }).success).toBe(true);
    expect(BusinessRuleDetails.safeParse({ rule: 'SOMETHING' }).success).toBe(false);
    expect(NotFoundDetails.safeParse({ resource: 'task' }).success).toBe(true);
    expect(NotFoundDetails.safeParse({ resource: 'route' }).success).toBe(true);
    expect(NotFoundDetails.safeParse({ resource: 'comment' }).success).toBe(false);
    expect(ResourceConflictDetails.safeParse({ field: 'slug', reason: 'taken' }).success).toBe(
      true,
    );
    expect(ResourceConflictDetails.safeParse({ field: 'slug' }).success).toBe(false);
    expect(RateLimitedDetails.safeParse({ retryAfterSec: 30 }).success).toBe(true);
    expect(RateLimitedDetails.safeParse({ retryAfterSec: -1 }).success).toBe(false);
    expect(ProjectArchivedDetails.safeParse({ projectId: ID }).success).toBe(true);
    expect(
      InvalidStatusTransitionDetails.safeParse({
        from: 'TODO',
        to: 'DONE',
        allowed: ['IN_PROGRESS'],
      }).success,
    ).toBe(true);
    expect(
      InvalidStatusTransitionDetails.safeParse({ from: 'TODO', to: 'ARCHIVED', allowed: [] })
        .success,
    ).toBe(false);
  });
});

describe('event server → client còn lại', () => {
  it('task:deleted mang key + version sau xóa', () => {
    const data = { taskId: ID, projectId: ID, key: sampleTask.key, version: 2 };
    expect(TaskDeletedEvent.safeParse({ ...envelope, type: 'task:deleted', data }).success).toBe(
      true,
    );
    expect(TaskDeletedEvent.safeParse({ ...envelope, type: 'task:created', data }).success).toBe(
      false,
    );
  });

  it('project:updated, workspace:access-revoked, member:role-changed, auth:expired', () => {
    expect(
      ProjectUpdatedEvent.safeParse({ ...envelope, type: 'project:updated', data: { project } })
        .success,
    ).toBe(true);
    expect(
      WorkspaceAccessRevokedEvent.safeParse({
        ...envelope,
        type: 'workspace:access-revoked',
        data: { workspaceId: ID },
      }).success,
    ).toBe(true);
    expect(
      MemberRoleChangedEvent.safeParse({
        ...envelope,
        type: 'member:role-changed',
        data: { workspaceId: ID, role: 'GUEST' },
      }).success,
    ).toBe(false);
    expect(
      AuthExpiredEvent.safeParse({ ...envelope, type: 'auth:expired', data: {} }).success,
    ).toBe(true);
  });
});
