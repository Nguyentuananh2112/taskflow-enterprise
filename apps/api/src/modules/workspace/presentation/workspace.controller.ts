import type {
  AddMemberBody,
  ChangeMemberRoleBody,
  CreateWorkspaceBody,
  DeleteWorkspaceBody,
  ListMembersQuery,
  ListWorkspacesQuery,
  MemberCandidatesQuery,
  UpdateWorkspaceBody,
} from '@taskflow/contracts';
import type { Request, Response } from 'express';

import { compact } from '../../../core/http/compact';
import type { HttpResponder } from '../../../core/http/envelope';
import { pageMeta } from '../../../core/http/pagination';
import { clientIdOf, requireUser } from '../../../core/http/request-user';
import type { AddMemberUseCase } from '../application/use-cases/add-member.use-case';
import type { ChangeMemberRoleUseCase } from '../application/use-cases/change-member-role.use-case';
import type { CreateWorkspaceUseCase } from '../application/use-cases/create-workspace.use-case';
import type { DeleteWorkspaceUseCase } from '../application/use-cases/delete-workspace.use-case';
import type { ListMemberCandidatesQuery } from '../application/use-cases/list-member-candidates.query';
import type { ListMembersQuery as ListMembers } from '../application/use-cases/list-members.query';
import type { RemoveMemberUseCase } from '../application/use-cases/remove-member.use-case';
import type { RestoreWorkspaceUseCase } from '../application/use-cases/restore-workspace.use-case';
import type { UpdateWorkspaceUseCase } from '../application/use-cases/update-workspace.use-case';
import type {
  GetWorkspaceQuery,
  ListMyWorkspacesQuery,
} from '../application/use-cases/workspace.queries';
import { actorOf } from './membership';
import { uuidAfterFromCursor } from './keyset-cursor';

export interface WorkspaceControllerDeps {
  listMine: Pick<ListMyWorkspacesQuery, 'execute'>;
  create: Pick<CreateWorkspaceUseCase, 'execute'>;
  get: Pick<GetWorkspaceQuery, 'execute'>;
  update: Pick<UpdateWorkspaceUseCase, 'execute'>;
  remove: Pick<DeleteWorkspaceUseCase, 'execute'>;
  restore: Pick<RestoreWorkspaceUseCase, 'execute'>;
  listMembers: Pick<ListMembers, 'execute'>;
  memberCandidates: Pick<ListMemberCandidatesQuery, 'execute'>;
  addMember: Pick<AddMemberUseCase, 'execute'>;
  changeRole: Pick<ChangeMemberRoleUseCase, 'execute'>;
  removeMember: Pick<RemoveMemberUseCase, 'execute'>;
  responder: HttpResponder;
}

const MEMBERS_CURSOR = 'members';

/** Workspace + thành viên (data-and-api §2.5). Controller chỉ gọi use case/query (ADR-015). */
export class WorkspaceController {
  constructor(private readonly d: WorkspaceControllerDeps) {}

  list = async (req: Request, res: Response) => {
    const { deleted } = req.query as unknown as ListWorkspacesQuery;
    const userId = requireUser(req).id;
    const data =
      deleted === 'true'
        ? await this.d.listMine.execute({ userId, deleted: true })
        : await this.d.listMine.execute({ userId, deleted: false });
    this.d.responder.ok(res, data);
  };

  create = async (req: Request, res: Response) => {
    const body = req.body as CreateWorkspaceBody;
    this.d.responder.created(
      res,
      await this.d.create.execute({ ...body, userId: requireUser(req).id }),
    );
  };

  get = async (req: Request, res: Response) => {
    this.d.responder.ok(res, await this.d.get.execute(actorOf(req)));
  };

  update = async (req: Request, res: Response) => {
    const body = req.body as UpdateWorkspaceBody;
    this.d.responder.ok(res, await this.d.update.execute(actorOf(req), compact(body)));
  };

  remove = async (req: Request, res: Response) => {
    const { confirmSlug } = req.body as DeleteWorkspaceBody;
    this.d.responder.ok(
      res,
      await this.d.remove.execute(actorOf(req), { confirmSlug, originClientId: clientIdOf(req) }),
    );
  };

  restore = async (req: Request, res: Response) => {
    const { wsId } = req.params as { wsId: string };
    this.d.responder.ok(
      res,
      await this.d.restore.execute({ userId: requireUser(req).id, workspaceId: wsId }),
    );
  };

  listMembers = async (req: Request, res: Response) => {
    const query = req.query as unknown as ListMembersQuery;
    const page = await this.d.listMembers.execute(actorOf(req), {
      ...(query.q === undefined ? {} : { q: query.q }),
      after: uuidAfterFromCursor(MEMBERS_CURSOR, query.cursor),
      limit: query.limit,
    });
    this.d.responder.ok(res, page.items, pageMeta(MEMBERS_CURSOR, page.nextAfter, query.limit));
  };

  memberCandidates = async (req: Request, res: Response) => {
    const { q } = req.query as unknown as MemberCandidatesQuery;
    this.d.responder.ok(res, await this.d.memberCandidates.execute(actorOf(req), { q }));
  };

  addMember = async (req: Request, res: Response) => {
    const body = req.body as AddMemberBody;
    this.d.responder.created(res, await this.d.addMember.execute(actorOf(req), body));
  };

  changeRole = async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    const { role } = req.body as ChangeMemberRoleBody;
    this.d.responder.ok(
      res,
      await this.d.changeRole.execute(actorOf(req), {
        userId,
        role,
        originClientId: clientIdOf(req),
      }),
    );
  };

  removeMember = async (req: Request, res: Response) => {
    const { userId } = req.params as { userId: string };
    this.d.responder.ok(
      res,
      await this.d.removeMember.execute(actorOf(req), { userId, originClientId: clientIdOf(req) }),
    );
  };
}
