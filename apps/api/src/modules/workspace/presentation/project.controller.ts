import type { CreateProjectBody, ListProjectsQuery, UpdateProjectBody } from '@taskflow/contracts';
import type { Request, Response } from 'express';

import { compact } from '../../../core/http/compact';
import type { HttpResponder } from '../../../core/http/envelope';
import { pageMeta } from '../../../core/http/pagination';
import { clientIdOf } from '../../../core/http/request-user';
import type { CreateProjectUseCase } from '../application/use-cases/create-project.use-case';
import type {
  GetProjectQuery,
  ListProjectsQuery as ListProjects,
} from '../application/use-cases/project.queries';
import type { SetProjectArchivedUseCase } from '../application/use-cases/set-project-archived.use-case';
import type { UpdateProjectUseCase } from '../application/use-cases/update-project.use-case';
import { actorOf } from './membership';
import { uuidAfterFromCursor } from './keyset-cursor';

export interface ProjectControllerDeps {
  list: Pick<ListProjects, 'execute'>;
  create: Pick<CreateProjectUseCase, 'execute'>;
  get: Pick<GetProjectQuery, 'execute'>;
  update: Pick<UpdateProjectUseCase, 'execute'>;
  setArchived: Pick<SetProjectArchivedUseCase, 'execute'>;
  responder: HttpResponder;
}

const PROJECTS_CURSOR = 'projects';
const projectIdOf = (req: Request) => (req.params as { projectId: string }).projectId;

/** Project (data-and-api §2.6). Không có xóa project ở v1 — chỉ archive (ADR-040). */
export class ProjectController {
  constructor(private readonly d: ProjectControllerDeps) {}

  list = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListProjectsQuery;
    const page = await this.d.list.execute(actorOf(req), {
      archived: query.archived,
      after: uuidAfterFromCursor(PROJECTS_CURSOR, query.cursor),
      limit: query.limit,
    });
    this.d.responder.ok(res, page.items, pageMeta(PROJECTS_CURSOR, page.nextAfter, query.limit));
  };

  create = async (req: Request, res: Response) => {
    const body = req.body as CreateProjectBody;
    this.d.responder.created(res, await this.d.create.execute(actorOf(req), compact(body)));
  };

  get = async (req: Request, res: Response) => {
    this.d.responder.ok(
      res,
      await this.d.get.execute(actorOf(req), { projectId: projectIdOf(req) }),
    );
  };

  update = async (req: Request, res: Response) => {
    const body = req.body as UpdateProjectBody;
    this.d.responder.ok(
      res,
      await this.d.update.execute(actorOf(req), {
        ...compact(body),
        projectId: projectIdOf(req),
        originClientId: clientIdOf(req),
      }),
    );
  };

  archive = async (req: Request, res: Response) => {
    this.d.responder.ok(
      res,
      await this.d.setArchived.execute(actorOf(req), {
        projectId: projectIdOf(req),
        archived: true,
        originClientId: clientIdOf(req),
      }),
    );
  };

  unarchive = async (req: Request, res: Response) => {
    this.d.responder.ok(
      res,
      await this.d.setArchived.execute(actorOf(req), {
        projectId: projectIdOf(req),
        archived: false,
        originClientId: clientIdOf(req),
      }),
    );
  };
}
