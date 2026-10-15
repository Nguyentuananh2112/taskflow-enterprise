import type {
  AssignTaskBody,
  CreateTaskBody,
  DeleteTaskQuery,
  ListAuditLogsQuery,
  ListTasksQuery,
  MoveTaskBody,
  UpdateTaskBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import { compact } from '../../../core/http/compact';
import type { HttpResponder } from '../../../core/http/envelope';
import { clientIdOf } from '../../../core/http/request-user';
import type { TaskScope } from '../application/task-actor';
import type { TaskQueries } from '../application/use-cases/task.queries';
import type { AssignTaskUseCase } from '../application/use-cases/assign-task.use-case';
import type { CreateTaskUseCase } from '../application/use-cases/create-task.use-case';
import type { DeleteTaskUseCase } from '../application/use-cases/delete-task.use-case';
import type { MoveTaskUseCase } from '../application/use-cases/move-task.use-case';
import type { UpdateTaskUseCase } from '../application/use-cases/update-task.use-case';
import { taskActorOf } from './task-membership';

export interface TaskControllerDeps {
  create: Pick<CreateTaskUseCase, 'execute'>;
  update: Pick<UpdateTaskUseCase, 'execute'>;
  move: Pick<MoveTaskUseCase, 'execute'>;
  assign: Pick<AssignTaskUseCase, 'execute'>;
  remove: Pick<DeleteTaskUseCase, 'execute'>;
  queries: Pick<TaskQueries, 'getTask' | 'listTasks' | 'listAuditLogs'>;
  responder: HttpResponder;
}

/** Phạm vi tenant từ URL + actor đã nạp (ADR-020) + `X-Client-Id` (chỉ để FE bỏ event của chính mình). */
function scopeOf(req: Request): TaskScope {
  const { wsId, projectId } = req.params as { wsId: string; projectId: string };
  return { workspaceId: wsId, projectId, actor: taskActorOf(req), clientId: clientIdOf(req) };
}

const taskIdOf = (req: Request) => (req.params as { taskId: string }).taskId;

/** Task (data-and-api §2.7). Controller chỉ gọi use case/query (ADR-015); use case tự kiểm 404→403→422→409. */
export class TaskController {
  constructor(private readonly d: TaskControllerDeps) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListTasksQuery;
    const { items, page } = await this.d.queries.listTasks({
      ...scopeOf(req),
      query: compact(query),
    });
    this.d.responder.ok(res, items, page);
  };

  get = async (req: Request, res: Response) => {
    this.d.responder.ok(
      res,
      await this.d.queries.getTask({ ...scopeOf(req), taskId: taskIdOf(req) }),
    );
  };

  create = async (req: Request, res: Response) => {
    const body = req.body as CreateTaskBody;
    this.d.responder.created(
      res,
      await this.d.create.execute({ ...scopeOf(req), input: compact(body) }),
    );
  };

  update = async (req: Request, res: Response) => {
    const body = req.body as UpdateTaskBody;
    this.d.responder.ok(
      res,
      await this.d.update.execute({ ...scopeOf(req), taskId: taskIdOf(req), input: compact(body) }),
    );
  };

  move = async (req: Request, res: Response) => {
    const body = req.body as MoveTaskBody;
    this.d.responder.ok(
      res,
      await this.d.move.execute({ ...scopeOf(req), taskId: taskIdOf(req), input: compact(body) }),
    );
  };

  assign = async (req: Request, res: Response) => {
    const body = req.body as AssignTaskBody;
    this.d.responder.ok(
      res,
      await this.d.assign.execute({ ...scopeOf(req), taskId: taskIdOf(req), input: body }),
    );
  };

  remove = async (req: Request, res: Response) => {
    const query = req.query as unknown as DeleteTaskQuery;
    this.d.responder.ok(
      res,
      await this.d.remove.execute({
        ...scopeOf(req),
        taskId: taskIdOf(req),
        input: compact(query),
      }),
    );
  };

  auditLogs = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListAuditLogsQuery;
    const { items, page } = await this.d.queries.listAuditLogs({
      ...scopeOf(req),
      taskId: taskIdOf(req),
      query: compact(query),
    });
    this.d.responder.ok(res, items, page);
  };
}
