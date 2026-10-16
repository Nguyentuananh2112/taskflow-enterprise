import * as z from 'zod';

import { AuditLogDto, ListAuditLogsQuery } from '../audit/audit.schemas';
import {
  HrAuditLogDto,
  ListHrAuditLogsQuery,
  ListNotificationsQuery,
  NotificationDto,
  NotificationParams,
  UnreadNotificationCountDto,
} from '../hr/hr.schemas';
import {
  AuthTokenDto,
  ChangePasswordBody,
  LoginBody,
  LoginResponse,
  MeResponse,
  RegisterBody,
  RegisterResponse,
  UpdateMeBody,
  UserDto,
} from '../auth/auth.schemas';
import type { ErrorCode } from '../common/error-codes';
import {
  CreateProjectBody,
  ListProjectsQuery,
  ProjectDto,
  ProjectParams,
  UpdateProjectBody,
} from '../project/project.schemas';
import {
  AssignTaskBody,
  CreateTaskBody,
  DeleteTaskQuery,
  DeleteTaskResponse,
  ListTasksQuery,
  MoveTaskBody,
  TaskDto,
  TaskParams,
  UpdateTaskBody,
} from '../task';
import {
  AddMemberBody,
  ChangeMemberRoleBody,
  ChangeMemberRoleResponse,
  CreateWorkspaceBody,
  DeletedWorkspaceDto,
  DeleteWorkspaceBody,
  ListMembersQuery,
  ListWorkspacesQuery,
  MemberDto,
  MemberParams,
  RemoveMemberResponse,
  SetMemberGrantsBody,
  UpdateWorkspaceBody,
  WorkspaceDto,
  WorkspaceParams,
} from '../workspace';

/**
 * Danh mục route HTTP của `/api/v1` — NGUỒN của OpenAPI (A2, sinh từ Zod, không viết tay). Test
 * parity ở apps/api so khớp danh mục này với router Express thật (thiếu/thừa route ⇒ đỏ). Bảng mô tả
 * nghiệp vụ: docs/design/data-and-api.md §2.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type Security = 'bearer' | 'refreshCookie' | 'none';
export type Tag = 'auth' | 'workspaces' | 'members' | 'projects' | 'tasks' | 'hr' | 'notifications';

export interface ApiRoute {
  method: HttpMethod;
  /** Tương đối `/api/v1`, tham số dạng `{wsId}` (OpenAPI). */
  path: string;
  summary: string;
  tag: Tag;
  security: Security;
  params?: z.ZodObject;
  query?: z.ZodType;
  body?: z.ZodType;
  /** 204 ⇒ không body; còn lại `data` của envelope; `paged` ⇒ có `meta.page`. */
  response: { status: 200 | 201 | 204; data?: z.ZodType; paged?: boolean };
  /** Mã lỗi đặc thù của route (ngoài lỗi chung 400/401/403/404/429). */
  errors?: readonly ErrorCode[];
}

const WS = '/workspaces/{wsId}';
const PROJECT = `${WS}/projects/{projectId}`;
const TASKS = `${PROJECT}/tasks`;

export const API_ROUTES: readonly ApiRoute[] = [
  // ---------- auth ----------
  {
    method: 'post',
    path: '/auth/register',
    summary: 'Đăng ký tài khoản (đồng thời tạo workspace mặc định)',
    tag: 'auth',
    security: 'none',
    body: RegisterBody,
    response: { status: 201, data: RegisterResponse },
    errors: ['EMAIL_ALREADY_EXISTS', 'RATE_LIMITED'],
  },
  {
    method: 'post',
    path: '/auth/login',
    summary: 'Đăng nhập — access token + cookie refresh',
    tag: 'auth',
    security: 'none',
    body: LoginBody,
    response: { status: 200, data: LoginResponse },
    errors: ['INVALID_CREDENTIALS', 'RATE_LIMITED'],
  },
  {
    method: 'post',
    path: '/auth/refresh',
    summary: 'Xoay refresh token (cookie + kiểm Origin)',
    tag: 'auth',
    security: 'refreshCookie',
    response: { status: 200, data: AuthTokenDto },
    errors: ['REFRESH_TOKEN_INVALID', 'REFRESH_IN_PROGRESS', 'ORIGIN_NOT_ALLOWED'],
  },
  {
    method: 'post',
    path: '/auth/logout',
    summary: 'Đăng xuất phiên hiện tại (idempotent)',
    tag: 'auth',
    security: 'refreshCookie',
    response: { status: 204 },
    errors: ['ORIGIN_NOT_ALLOWED'],
  },
  {
    method: 'post',
    path: '/auth/logout-all',
    summary: 'Đăng xuất mọi thiết bị',
    tag: 'auth',
    security: 'bearer',
    response: { status: 204 },
  },
  {
    method: 'get',
    path: '/auth/me',
    summary: 'Người dùng hiện tại + membership',
    tag: 'auth',
    security: 'bearer',
    response: { status: 200, data: MeResponse },
  },
  {
    method: 'patch',
    path: '/auth/me',
    summary: 'Đổi tên hiển thị',
    tag: 'auth',
    security: 'bearer',
    body: UpdateMeBody,
    response: { status: 200, data: UserDto },
  },
  {
    method: 'post',
    path: '/auth/change-password',
    summary: 'Đổi mật khẩu — phiên mới cho thiết bị này, thu hồi phiên khác',
    tag: 'auth',
    security: 'bearer',
    body: ChangePasswordBody,
    response: { status: 200, data: AuthTokenDto },
    errors: ['INVALID_CURRENT_PASSWORD'],
  },

  // ---------- workspaces ----------
  {
    method: 'get',
    path: '/workspaces',
    summary: 'Workspace của tôi (deleted=true ⇒ đã xóa mềm còn khôi phục được)',
    tag: 'workspaces',
    security: 'bearer',
    query: ListWorkspacesQuery,
    response: { status: 200, data: z.union([z.array(WorkspaceDto), z.array(DeletedWorkspaceDto)]) },
  },
  {
    method: 'post',
    path: '/workspaces',
    summary: 'Tạo workspace (người tạo là OWNER)',
    tag: 'workspaces',
    security: 'bearer',
    body: CreateWorkspaceBody,
    response: { status: 201, data: WorkspaceDto },
    errors: ['RESOURCE_CONFLICT'],
  },
  {
    method: 'get',
    path: WS,
    summary: 'Chi tiết workspace',
    tag: 'workspaces',
    security: 'bearer',
    params: WorkspaceParams,
    response: { status: 200, data: WorkspaceDto },
  },
  {
    method: 'patch',
    path: WS,
    summary: 'Đổi tên / slug',
    tag: 'workspaces',
    security: 'bearer',
    params: WorkspaceParams,
    body: UpdateWorkspaceBody,
    response: { status: 200, data: WorkspaceDto },
    errors: ['RESOURCE_CONFLICT'],
  },
  {
    method: 'delete',
    path: WS,
    summary: 'Xóa mềm (gõ lại slug để xác nhận)',
    tag: 'workspaces',
    security: 'bearer',
    params: WorkspaceParams,
    body: DeleteWorkspaceBody,
    response: { status: 200, data: DeletedWorkspaceDto },
  },
  {
    method: 'post',
    path: `${WS}/restore`,
    summary: 'Khôi phục workspace đã xóa mềm (OWNER, trong thời gian ân hạn)',
    tag: 'workspaces',
    security: 'bearer',
    params: WorkspaceParams,
    response: { status: 200, data: WorkspaceDto },
  },

  // ---------- members ----------
  {
    method: 'get',
    path: `${WS}/members`,
    summary: 'Danh sách thành viên (tìm theo tên/email trong workspace)',
    tag: 'members',
    security: 'bearer',
    params: WorkspaceParams,
    query: ListMembersQuery,
    response: { status: 200, data: z.array(MemberDto), paged: true },
  },
  {
    method: 'post',
    path: `${WS}/members`,
    summary: 'Thêm thành viên đã có tài khoản',
    tag: 'members',
    security: 'bearer',
    params: WorkspaceParams,
    body: AddMemberBody,
    response: { status: 201, data: MemberDto },
    errors: ['RESOURCE_CONFLICT'],
  },
  {
    method: 'patch',
    path: `${WS}/members/{userId}`,
    summary: 'Đổi vai trò (hạ xuống VIEWER ⇒ bỏ gán task)',
    tag: 'members',
    security: 'bearer',
    params: MemberParams,
    body: ChangeMemberRoleBody,
    response: { status: 200, data: ChangeMemberRoleResponse },
    errors: ['BUSINESS_RULE_VIOLATION'],
  },
  {
    method: 'delete',
    path: `${WS}/members/{userId}`,
    summary: 'Rời workspace / xóa thành viên',
    tag: 'members',
    security: 'bearer',
    params: MemberParams,
    response: { status: 200, data: RemoveMemberResponse },
    errors: ['BUSINESS_RULE_VIOLATION'],
  },
  {
    method: 'put',
    path: `${WS}/members/{userId}/grants`,
    summary:
      'Đặt quyền cấp thêm (Quản lý nhân sự) — chỉ OWNER; OWNER / VIEWER ⇒ 422 GRANT_NOT_ALLOWED',
    tag: 'members',
    security: 'bearer',
    params: MemberParams,
    body: SetMemberGrantsBody,
    response: { status: 200, data: MemberDto },
    errors: ['BUSINESS_RULE_VIOLATION'],
  },

  // ---------- hr (Mốc 3) ----------
  {
    method: 'get',
    path: `${WS}/hr-audit-logs`,
    summary: 'Nhật ký thao tác nhân sự — chỉ OWNER (không chứa lý do đơn nghỉ)',
    tag: 'hr',
    security: 'bearer',
    params: WorkspaceParams,
    query: ListHrAuditLogsQuery,
    response: { status: 200, data: z.array(HrAuditLogDto), paged: true },
  },

  // ---------- notifications (ADR-123, T-040) — luôn của người gọi, chỉ ws còn là thành viên ----------
  {
    method: 'get',
    path: '/me/notifications',
    summary: 'Thông báo của tôi (mới nhất trước); loại dành cho HR lọc theo quyền hiện tại',
    tag: 'notifications',
    security: 'bearer',
    query: ListNotificationsQuery,
    response: { status: 200, data: z.array(NotificationDto), paged: true },
  },
  {
    method: 'get',
    path: '/me/notifications/unread-count',
    summary: 'Số thông báo chưa đọc (chuông)',
    tag: 'notifications',
    security: 'bearer',
    response: { status: 200, data: UnreadNotificationCountDto },
  },
  {
    method: 'post',
    path: '/me/notifications/read-all',
    summary: 'Đánh dấu mọi thông báo của tôi đã đọc',
    tag: 'notifications',
    security: 'bearer',
    response: { status: 204 },
  },
  {
    method: 'post',
    path: '/me/notifications/{id}/read',
    summary: 'Đánh dấu một thông báo đã đọc (id của người khác ⇒ 404)',
    tag: 'notifications',
    security: 'bearer',
    params: NotificationParams,
    response: { status: 204 },
  },

  // ---------- projects ----------
  {
    method: 'get',
    path: `${WS}/projects`,
    summary: 'Danh sách project',
    tag: 'projects',
    security: 'bearer',
    params: WorkspaceParams,
    query: ListProjectsQuery,
    response: { status: 200, data: z.array(ProjectDto), paged: true },
  },
  {
    method: 'post',
    path: `${WS}/projects`,
    summary: 'Tạo project',
    tag: 'projects',
    security: 'bearer',
    params: WorkspaceParams,
    body: CreateProjectBody,
    response: { status: 201, data: ProjectDto },
    errors: ['RESOURCE_CONFLICT'],
  },
  {
    method: 'get',
    path: PROJECT,
    summary: 'Chi tiết project',
    tag: 'projects',
    security: 'bearer',
    params: ProjectParams,
    response: { status: 200, data: ProjectDto },
  },
  {
    method: 'patch',
    path: PROJECT,
    summary: 'Sửa project (keyPrefix bất biến)',
    tag: 'projects',
    security: 'bearer',
    params: ProjectParams,
    body: UpdateProjectBody,
    response: { status: 200, data: ProjectDto },
    errors: ['PROJECT_ARCHIVED'],
  },
  {
    method: 'post',
    path: `${PROJECT}/archive`,
    summary: 'Lưu trữ project (idempotent)',
    tag: 'projects',
    security: 'bearer',
    params: ProjectParams,
    response: { status: 200, data: ProjectDto },
  },
  {
    method: 'post',
    path: `${PROJECT}/unarchive`,
    summary: 'Bỏ lưu trữ project (idempotent)',
    tag: 'projects',
    security: 'bearer',
    params: ProjectParams,
    response: { status: 200, data: ProjectDto },
  },

  // ---------- tasks ----------
  {
    method: 'get',
    path: TASKS,
    summary: 'Task của project (sắp theo status, rank)',
    tag: 'tasks',
    security: 'bearer',
    params: ProjectParams,
    query: ListTasksQuery,
    response: { status: 200, data: z.array(TaskDto), paged: true },
  },
  {
    method: 'post',
    path: TASKS,
    summary: 'Tạo task (vào cuối cột TODO)',
    tag: 'tasks',
    security: 'bearer',
    params: ProjectParams,
    body: CreateTaskBody,
    response: { status: 201, data: TaskDto },
    errors: ['PROJECT_ARCHIVED', 'BUSINESS_RULE_VIOLATION'],
  },
  {
    method: 'get',
    path: `${TASKS}/{taskId}`,
    summary: 'Chi tiết task',
    tag: 'tasks',
    security: 'bearer',
    params: TaskParams,
    response: { status: 200, data: TaskDto },
  },
  {
    method: 'patch',
    path: `${TASKS}/{taskId}`,
    summary: 'Sửa task (optimistic lock: expectedVersion)',
    tag: 'tasks',
    security: 'bearer',
    params: TaskParams,
    body: UpdateTaskBody,
    response: { status: 200, data: TaskDto },
    errors: ['VERSION_CONFLICT', 'PROJECT_ARCHIVED'],
  },
  {
    method: 'patch',
    path: `${TASKS}/{taskId}/move`,
    summary: 'Kéo thả: đổi cột và/hoặc vị trí',
    tag: 'tasks',
    security: 'bearer',
    params: TaskParams,
    body: MoveTaskBody,
    response: { status: 200, data: TaskDto },
    errors: [
      'VERSION_CONFLICT',
      'RESOURCE_CONFLICT',
      'INVALID_STATUS_TRANSITION',
      'PROJECT_ARCHIVED',
    ],
  },
  {
    method: 'patch',
    path: `${TASKS}/{taskId}/assignee`,
    summary: 'Gán / bỏ gán',
    tag: 'tasks',
    security: 'bearer',
    params: TaskParams,
    body: AssignTaskBody,
    response: { status: 200, data: TaskDto },
    errors: ['VERSION_CONFLICT', 'PROJECT_ARCHIVED', 'BUSINESS_RULE_VIOLATION'],
  },
  {
    method: 'delete',
    path: `${TASKS}/{taskId}`,
    summary: 'Xóa mềm task',
    tag: 'tasks',
    security: 'bearer',
    params: TaskParams,
    query: DeleteTaskQuery,
    response: { status: 200, data: DeleteTaskResponse },
    errors: ['VERSION_CONFLICT', 'PROJECT_ARCHIVED'],
  },
  {
    method: 'get',
    path: `${TASKS}/{taskId}/audit-logs`,
    summary: 'Lịch sử thay đổi (đọc được cả khi task đã xóa)',
    tag: 'tasks',
    security: 'bearer',
    params: TaskParams,
    query: ListAuditLogsQuery,
    response: { status: 200, data: z.array(AuditLogDto), paged: true },
  },
];
