import { AggregateRoot } from '../../../core/domain';
import { ValidationError, VersionConflictError } from '../../../core/errors';
import { Rank } from './rank';
import { TaskAlreadyDeletedError } from './task-errors';
import type { TaskEvent, UpdatableField, UpdatableValues } from './task-events';
import {
  assertTaskNumber,
  normalizeDescription,
  normalizeDueDate,
  normalizeTitle,
} from './task-fields';
import type { CreateTaskProps, TaskChanges, TaskProps } from './task-props';
import { assertTransition, type TaskStatus } from './task-status';

export type { CreateTaskProps, TaskChanges, TaskProps } from './task-props';

/**
 * Aggregate Task (ADR-013). Domain không biết project archived, membership hay quyền (ADR-021).
 * Mọi lệnh đổi trạng thái trả `false` khi không đổi gì (R15): không tăng version, không event.
 * Mỗi thay đổi thật: `version + 1` đúng một lần và đúng một domain event.
 */
export class Task extends AggregateRoot<TaskEvent> {
  private constructor(private props: TaskProps) {
    super(props.id);
  }

  static create(input: CreateTaskProps): Task {
    assertTaskNumber(input.number);
    const task = new Task({
      id: input.id,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      number: input.number,
      title: normalizeTitle(input.title),
      description: normalizeDescription(input.description),
      status: 'TODO',
      priority: input.priority ?? 'MEDIUM',
      rank: Rank.of(input.rank).value,
      version: 1,
      dueDate: normalizeDueDate(input.dueDate),
      assigneeId: input.assigneeId ?? null,
      createdById: input.createdById,
      deletedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    const p = task.props;
    task.emit('TaskCreated', input.createdById, input.now, {
      snapshot: {
        number: p.number,
        title: p.title,
        status: p.status,
        priority: p.priority,
        rank: p.rank,
        dueDate: p.dueDate,
        assigneeId: p.assigneeId,
      },
    });
    return task;
  }

  /** Dựng lại từ lưu trữ — không phát event. */
  static reconstitute(props: TaskProps): Task {
    return new Task({ ...props });
  }

  get workspaceId(): string {
    return this.props.workspaceId;
  }
  get projectId(): string {
    return this.props.projectId;
  }
  get status(): TaskStatus {
    return this.props.status;
  }
  get rank(): string {
    return this.props.rank;
  }
  get version(): number {
    return this.props.version;
  }
  get assigneeId(): string | null {
    return this.props.assigneeId;
  }
  get createdById(): string | null {
    return this.props.createdById;
  }
  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /** ADR-010: lệch ⇒ 409. Use case gọi **trước** khi phát hiện no-op (ADR-091). */
  assertVersion(expected: number): void {
    if (expected !== this.props.version) throw new VersionConflictError(this.props.version);
  }

  update(changes: TaskChanges, actorId: string, now: Date): boolean {
    this.assertAlive();
    const next = this.normalizeChanges(changes);
    const changed = (Object.keys(next) as UpdatableField[]).filter(
      (f) => next[f] !== this.props[f],
    );
    if (changed.length === 0) return false;
    const old: UpdatableValues = {};
    const neu: UpdatableValues = {};
    for (const f of changed) {
      Object.assign(old, { [f]: this.props[f] });
      Object.assign(neu, { [f]: next[f] });
    }
    Object.assign(this.props, neu);
    this.bump(now);
    this.emit('TaskUpdated', actorId, now, { changedFields: changed, old, new: neu });
    return true;
  }

  moveTo(target: TaskStatus, newRank: Rank, actorId: string, now: Date): boolean {
    this.assertAlive();
    assertTransition(this.props.status, target);
    const { status: from, rank: fromRank } = this.props;
    if (target === from && newRank.value === fromRank) return false;
    this.props.status = target;
    this.props.rank = newRank.value;
    this.bump(now);
    if (target === from) {
      this.emit('TaskMoved', actorId, now, { status: from, fromRank, toRank: newRank.value });
    } else {
      this.emit('TaskStatusChanged', actorId, now, {
        from,
        to: target,
        fromRank,
        toRank: newRank.value,
      });
    }
    return true;
  }

  assignTo(assigneeId: string | null, actorId: string, now: Date): boolean {
    this.assertAlive();
    const from = this.props.assigneeId;
    if (from === assigneeId) return false;
    this.props.assigneeId = assigneeId;
    this.bump(now);
    this.emit('TaskAssigneeChanged', actorId, now, { from, to: assigneeId });
    return true;
  }

  softDelete(actorId: string, now: Date): void {
    this.assertAlive();
    this.props.deletedAt = now;
    this.bump(now);
    const { number, version, title, status } = this.props;
    this.emit('TaskDeleted', actorId, now, { number, version, title, status });
  }

  toPrimitives(): TaskProps {
    return { ...this.props };
  }

  private normalizeChanges(changes: TaskChanges): UpdatableValues {
    const next: UpdatableValues = {};
    if (changes.title !== undefined) next.title = normalizeTitle(changes.title);
    if (changes.description !== undefined) {
      next.description = normalizeDescription(changes.description);
    }
    if (changes.priority !== undefined) next.priority = changes.priority;
    if (changes.dueDate !== undefined) next.dueDate = normalizeDueDate(changes.dueDate);
    if (Object.keys(next).length === 0) {
      throw new ValidationError([
        { path: [], code: 'too_small', message: 'Phải có ít nhất một trường cần sửa.' },
      ]);
    }
    return next;
  }

  private assertAlive(): void {
    if (this.isDeleted) throw new TaskAlreadyDeletedError(this.id);
  }

  private bump(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }

  private emit<T extends TaskEvent['type']>(
    type: T,
    actorId: string,
    now: Date,
    data: Omit<Extract<TaskEvent, { type: T }>, keyof TaskEventCommon | 'type'>,
  ): void {
    this.addDomainEvent({
      type,
      aggregateId: this.id,
      occurredAt: now,
      workspaceId: this.props.workspaceId,
      projectId: this.props.projectId,
      actorId,
      ...data,
    } as Extract<TaskEvent, { type: T }>);
  }
}

type TaskEventCommon = Pick<
  TaskEvent,
  'aggregateId' | 'occurredAt' | 'workspaceId' | 'projectId' | 'actorId'
>;
