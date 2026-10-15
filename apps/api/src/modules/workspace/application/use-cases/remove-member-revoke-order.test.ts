// G1 realtime F3: thu hồi quyền realtime của người bị xóa phải chạy TRƯỚC các hook bỏ gán task của
// cleaner (hook afterCommit chạy tuần tự theo thứ tự đăng ký). Trước đây cleaner đăng ký 2N hook
// trước ⇒ người bị xóa còn trong phòng project và nhận event của workspace trong suốt chuỗi hook đó.
import { beforeEach, describe, expect, it } from 'vitest';

import type { ITaskAssignmentCleaner } from '../ports/collaborators.port';
import {
  createWorkspaceHarness,
  givenWorkspaceA,
  uid,
  type WorkspaceHarness,
} from '../../testing/harness';
import { RemoveMemberUseCase } from './remove-member.use-case';

let h: WorkspaceHarness;
let ctx: Awaited<ReturnType<typeof givenWorkspaceA>>;
beforeEach(async () => {
  h = createWorkspaceHarness();
  ctx = await givenWorkspaceA(h);
});

describe('RemoveMember — thứ tự hook sau commit', () => {
  it('revokeWorkspaceAccess chạy TRƯỚC mọi hook bỏ gán task của cleaner', async () => {
    // Mỗi hook của cleaner ghi lại: lúc nó chạy, thu hồi đã xảy ra chưa (spy notifier ghi mọi lời gọi).
    const revokedWhenHookRan: boolean[] = [];
    const revoked = () => h.notifier.calls.some((c) => c.method === 'revokeWorkspaceAccess');
    // Cleaner giống bản thật của module Task: mỗi task bỏ gán đăng ký một hook phát `task:updated`.
    const cleaner: ITaskAssignmentCleaner = {
      unassignAllForUser: () => {
        for (let i = 0; i < 3; i += 1)
          h.uow.afterCommit(() => void revokedWhenHookRan.push(revoked()));
        return Promise.resolve({ unassignedTaskCount: 3 });
      },
    };

    const result = await new RemoveMemberUseCase({ ...h, cleaner }).execute(ctx.alice, {
      userId: uid('mia'),
    });

    expect(result.unassignedTaskCount).toBe(3);
    expect(revokedWhenHookRan).toEqual([true, true, true]);
  });
});
