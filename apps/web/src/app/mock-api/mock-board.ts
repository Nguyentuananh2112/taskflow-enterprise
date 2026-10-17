import type { UserRefDto } from '@taskflow/contracts/auth';
import type { AuditLogDto, TaskAuditAction } from '@taskflow/contracts/audit';
import type { ProjectDto } from '@taskflow/contracts/project';
import type { ServerToClientEvents } from '@taskflow/contracts/realtime';
import { TASK_STATUS_ORDER, type TaskDto, type TaskStatus } from '@taskflow/contracts/task';
import { generateKeyBetween } from 'fractional-indexing';

import { compareByRank } from '@/shared/lib/rank';

// Dữ liệu project/task/audit trong bộ nhớ của mock API (T-025) + bus event realtime. Luật nghiệp vụ
// (quyền, state machine, version) nằm ở task-handlers; ở đây chỉ lưu và sắp xếp như DB.

type EventName = keyof ServerToClientEvents;
export type BoardEvent = {
  [E in EventName]: Readonly<{
    /** Phòng `project:{id}` (hoặc `user:{id}`) — như server thật. */
    room: string;
    name: E;
    payload: Parameters<ServerToClientEvents[E]>[0];
  }>;
}[EventName];

type StoredTask = TaskDto & { deleted: boolean };

export class MockBoard {
  private readonly projects = new Map<string, ProjectDto>();
  private readonly tasks = new Map<string, StoredTask>();
  private readonly audits: AuditLogDto[] = [];
  private readonly numbers = new Map<string, number>();
  private readonly listeners = new Set<(event: BoardEvent) => void>();

  /**
   * Mốc 6 (ADR-142): URL avatar HIỆN TẠI (variant 64) của người dùng — server tính lúc đọc (`avatarUrlOf`), task không
   * lưu URL. createMockApi nối vào MockAvatars. Không có ảnh ⇒ không thêm trường (giữ DTO cũ của các test trước).
   */
  avatarOf: (userId: string) => string | null = () => null;

  constructor(private readonly now: () => number) {}

  private withAvatar<T extends { id: string } | null>(user: T): T {
    const url = user && this.avatarOf(user.id);
    return user && url ? { ...user, avatarUrl: url } : user;
  }

  private strip = ({ deleted: _deleted, ...task }: StoredTask): TaskDto => ({
    ...task,
    assignee: this.withAvatar(task.assignee),
    createdBy: this.withAvatar(task.createdBy),
  });

  iso(): string {
    return new Date(this.now()).toISOString();
  }

  createProject(workspaceId: string, input: { name: string; keyPrefix: string }): ProjectDto {
    const at = this.iso();
    const project: ProjectDto = {
      id: crypto.randomUUID(),
      workspaceId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      description: null,
      isArchived: false,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    this.projects.set(project.id, project);
    return project;
  }

  getProject(workspaceId: string, projectId: string): ProjectDto | undefined {
    const project = this.projects.get(projectId);
    return project?.workspaceId === workspaceId ? project : undefined;
  }

  listProjects(workspaceId: string, archived: 'false' | 'true' | 'all'): ProjectDto[] {
    return [...this.projects.values()].filter(
      (p) =>
        p.workspaceId === workspaceId && (archived === 'all' || String(p.isArchived) === archived),
    );
  }

  saveProject(project: ProjectDto): void {
    this.projects.set(project.id, project);
  }

  /** Task chưa xóa, sắp theo (status, rank, id) như `GET …/tasks`. */
  listTasks(projectId: string): TaskDto[] {
    const order = (s: TaskStatus) => TASK_STATUS_ORDER.indexOf(s);
    return [...this.tasks.values()]
      .filter((t) => t.projectId === projectId && !t.deleted)
      .sort((a, b) => order(a.status) - order(b.status) || compareByRank(a, b))
      .map(this.strip);
  }

  getTask(projectId: string, taskId: string): TaskDto | undefined {
    const task = this.tasks.get(taskId);
    return task && task.projectId === projectId && !task.deleted ? this.strip(task) : undefined;
  }

  /** Kể cả task đã xóa mềm — lịch sử vẫn đọc được (R16). */
  hasTask(projectId: string, taskId: string): boolean {
    return this.tasks.get(taskId)?.projectId === projectId;
  }

  column(projectId: string, status: TaskStatus, exceptId?: string): TaskDto[] {
    return this.listTasks(projectId).filter((t) => t.status === status && t.id !== exceptId);
  }

  /** Task mới: số tăng dần theo project, cuối cột TODO (R12). */
  insertTask(
    project: ProjectDto,
    fields: Omit<
      TaskDto,
      | 'id'
      | 'number'
      | 'key'
      | 'rank'
      | 'version'
      | 'status'
      | 'workspaceId'
      | 'projectId'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): TaskDto {
    const number = (this.numbers.get(project.id) ?? 100) + 1;
    this.numbers.set(project.id, number);
    const last = this.column(project.id, 'TODO').at(-1);
    const at = this.iso();
    const task: TaskDto = {
      ...fields,
      id: crypto.randomUUID(),
      workspaceId: project.workspaceId,
      projectId: project.id,
      number,
      key: `${project.keyPrefix}-${number}`,
      status: 'TODO',
      rank: generateKeyBetween(last?.rank ?? null, null),
      version: 1,
      createdAt: at,
      updatedAt: at,
    };
    this.tasks.set(task.id, { ...task, deleted: false });
    return task;
  }

  saveTask(task: TaskDto, deleted = false): void {
    this.tasks.set(task.id, { ...task, deleted });
  }

  audit(
    task: TaskDto,
    action: TaskAuditAction,
    actor: UserRefDto,
    oldValue: AuditLogDto['oldValue'],
    newValue: AuditLogDto['newValue'],
  ): void {
    this.audits.push({
      id: crypto.randomUUID(),
      taskId: task.id,
      action,
      actor,
      oldValue,
      newValue,
      createdAt: this.iso(),
    });
  }

  /** Mới nhất trước (data-and-api §2.7). */
  auditsOf(taskId: string): AuditLogDto[] {
    return this.audits.filter((a) => a.taskId === taskId).reverse();
  }

  publish(event: BoardEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  onEvent(listener: (event: BoardEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}
