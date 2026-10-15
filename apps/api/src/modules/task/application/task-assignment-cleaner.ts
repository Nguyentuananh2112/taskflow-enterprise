import type { ITaskAssignmentCleaner } from '../../workspace';
import type { ProjectRef } from './ports/collaborators.port';
import type { TaskCommands } from './task-commands';

/**
 * Hiện thực port `ITaskAssignmentCleaner` của module Workspace (ADR-093, test-spec §3.3 UC-UN*):
 * gọi BÊN TRONG transaction của Workspace khi thành viên bị xóa/tự rời hoặc hạ xuống VIEWER.
 * Bỏ gán mọi task sống của user trong workspace, KỂ CẢ project archived (ADR-092): mỗi task
 * `version + 1` + audit `ASSIGNEE_CHANGED` (actor = người thao tác); `task:updated` sau commit.
 */
export class TaskAssignmentCleaner implements ITaskAssignmentCleaner {
  constructor(private readonly c: TaskCommands) {}

  async unassignAllForUser(input: {
    workspaceId: string;
    userId: string;
    actorId: string;
  }): Promise<{ unassignedTaskCount: number }> {
    const { d } = this.c;
    const tasks = await d.tasks.listAssignedForUpdate(input.workspaceId, input.userId);
    const projects = new Map<string, ProjectRef>();
    const now = d.clock.now();
    for (const task of tasks) {
      let project = projects.get(task.projectId);
      if (!project) {
        project =
          (await d.projects.findInWorkspace({
            workspaceId: input.workspaceId,
            projectId: task.projectId,
          })) ?? undefined;
        if (!project)
          throw new Error(`Project ${task.projectId} không thuộc ws ${input.workspaceId}`);
        projects.set(project.id, project);
      }
      const expectedVersion = task.version;
      task.assignTo(null, input.actorId, now);
      // Bỏ gán do hệ thống không có X-Client-Id: mọi tab (kể cả của actor) đều áp dụng event.
      await this.c.persist(
        task,
        project,
        { actorId: input.actorId, originClientId: null },
        // ADR-092: bỏ gán do hệ thống được chạy cả trong project archived.
        { kind: 'save', expectedVersion, allowArchivedProject: true },
      );
    }
    return { unassignedTaskCount: tasks.length };
  }
}
