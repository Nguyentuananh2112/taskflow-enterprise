import type { MediaUrlSigner } from '../core/files/media-url-signer';
import type { IAvatarDirectory } from '../modules/auth/application/ports/avatar-directory.port';
import type {
  IUserDirectory,
  UserSummary,
} from '../modules/workspace/application/ports/collaborators.port';
import { AuthUserDirectory } from './users';
import type { FilesBundle } from './files-setup';

export { avatarAuthDeps, ME_PATH } from './avatar-adapters';
import type { Persistence } from './persistence';

/**
 * Ảnh đại diện trong `UserRefDto` của MỌI module được giao (ADR-142, T-068): auth (riêng — UserDto), task (assignee,
 * createdBy, actor audit), workspace (thành viên, ứng viên), thông báo (actor), company (EmployeeDto). Attendance /
 * leave / hr-audit / payroll ĐỂ NGUYÊN (đội Mốc 4/5 thêm sau bằng `avatarRefs`). MỘT truy vấn cho cả trang; người đã
 * nghỉ / đã xóa / không có ảnh ⇒ `null`.
 */
export interface AvatarRefs {
  /** URL ký variant 64 của những id CÓ ảnh và còn thuộc công ty. */
  urlsOf(ids: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

export function avatarRefs(directory: IAvatarDirectory, signer: MediaUrlSigner): AvatarRefs {
  return {
    async urlsOf(ids) {
      const versions = await directory.activeVersions(ids);
      return new Map([...versions].map(([id, v]) => [id, signer.avatarUrl(id, v, '64')]));
    },
  };
}

/**
 * Ghi đè vài method của một adapter mà GIỮ nguyên phần còn lại. Không dùng `{ ...obj }`: adapter thường là instance của
 * class ⇒ spread làm mất method trên prototype (và field `#private` cần `this` gốc).
 */
export function overriding<T extends object>(target: T, overrides: Partial<T>): T {
  return new Proxy(target, {
    get(t, prop) {
      if (Object.hasOwn(overrides, prop)) return overrides[prop as keyof T];
      const value: unknown = Reflect.get(t, prop, t);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
    },
  });
}

type Ref = { id: string; fullName: string };
const refWith = <T extends Ref>(ref: T, urls: ReadonlyMap<string, string>) => ({
  ...ref,
  avatarUrl: urls.get(ref.id) ?? null,
});

/** Task: reader tên (TaskDto phía ghi) + read model (danh sách / chi tiết / audit — raw SQL không biết ảnh). */
function taskWithAvatars(task: Persistence['task'], refs: AvatarRefs): Persistence['task'] {
  const rm = task.readModel;
  type TaskDto = NonNullable<Awaited<ReturnType<typeof rm.getTask>>>;
  const decorate = async (tasks: TaskDto[]): Promise<TaskDto[]> => {
    const ids = tasks.flatMap((t) =>
      [t.assignee?.id, t.createdBy?.id].filter((x): x is string => !!x),
    );
    const urls = await refs.urlsOf(ids);
    return tasks.map((t) => ({
      ...t,
      assignee: t.assignee ? refWith(t.assignee, urls) : null,
      createdBy: t.createdBy ? refWith(t.createdBy, urls) : null,
    }));
  };
  return overriding(task, {
    users: overriding(task.users, {
      async findRefs(ids) {
        const [names, urls] = await Promise.all([task.users.findRefs(ids), refs.urlsOf(ids)]);
        return new Map([...names].map(([id, r]) => [id, refWith(r, urls)]));
      },
    }),
    readModel: overriding(rm, {
      getTask: async (...a) => {
        const t = await rm.getTask(...a);
        return t ? ((await decorate([t]))[0] ?? null) : null;
      },
      listTasks: async (...a) => decorate(await rm.listTasks(...a)),
      listAuditLogs: async (...a) => {
        const logs = await rm.listAuditLogs(...a);
        const urls = await refs.urlsOf(logs.map((l) => l.actor.id));
        return logs.map((l) => ({ ...l, actor: refWith(l.actor, urls) }));
      },
    }),
  });
}

function workspaceWithAvatars(
  ws: Persistence['workspace'],
  refs: AvatarRefs,
): Persistence['workspace'] {
  return overriding(ws, {
    queries: overriding(ws.queries, {
      listMembers: async (...a) => {
        const page = await ws.queries.listMembers(...a);
        const urls = await refs.urlsOf(page.items.map((m) => m.userId));
        return {
          ...page,
          items: page.items.map((m) => ({ ...m, avatarUrl: urls.get(m.userId) ?? null })),
        };
      },
    }),
    candidates: overriding(ws.candidates, {
      async search(input) {
        const found = await ws.candidates.search(input);
        const urls = await refs.urlsOf(found.map((c) => c.id));
        return found.map((c) => ({ ...c, avatarUrl: urls.get(c.id) ?? null }));
      },
    }),
  });
}

/** Bọc lưu trữ: không có kho tệp (test HTTP cũ) ⇒ trả nguyên, không gắn ảnh. */
export function withAvatarRefs(
  p: Persistence,
  files: FilesBundle | undefined,
): Persistence & { avatarRefs: AvatarRefs | undefined; userDirectory: IUserDirectory } {
  const users = new AuthUserDirectory(p.auth.users);
  if (!files) return { ...p, avatarRefs: undefined, userDirectory: users };
  const refs = avatarRefs(p.avatarDirectory, files.signer);
  return {
    ...p,
    avatarRefs: refs,
    userDirectory: userDirectoryWithAvatars(users, refs),
    task: taskWithAvatars(p.task, refs),
    workspace: workspaceWithAvatars(p.workspace, refs),
    notifications: overriding(p.notifications, {
      context: overriding(p.notifications.context, { actorAvatars: (ids) => refs.urlsOf(ids) }),
    }),
  };
}

/** Workspace thêm / đổi role thành viên (MemberDto trong response) — directory user + ảnh. */
export function userDirectoryWithAvatars(
  dir: IUserDirectory,
  refs: AvatarRefs | undefined,
): IUserDirectory {
  if (!refs) return dir;
  const withAvatar = async (u: UserSummary | null) =>
    u ? { ...u, avatarUrl: (await refs.urlsOf([u.id])).get(u.id) ?? null } : null;
  return {
    findByEmail: async (email) => withAvatar(await dir.findByEmail(email)),
    findById: async (id) => withAvatar(await dir.findById(id)),
  };
}
