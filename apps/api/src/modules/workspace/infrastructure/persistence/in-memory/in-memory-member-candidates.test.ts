import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '../../../../../core/errors';
import { ListMemberCandidatesQuery } from '../../../application/use-cases/list-member-candidates.query';
import { InMemoryMemberCandidates } from './in-memory-member-candidates';

// member-candidates (company-level ADR-134, SEC-HR-37, R41) — bản bộ nhớ + quyền của query.

const WS = 'ws-a';
const person = (id: string, fullName: string, email = `${id}@example.com`) => ({
  id,
  fullName,
  email,
});
const users = new Map(
  [
    person('olivia', 'Olivia'),
    person('pam', 'Pam'),
    person('mia', 'Mia'),
    person('nina', 'Nina'),
    person('quinn', 'Quinn'),
    person('lit', 'Lý 100%_x\\', 'lit@example.com'),
    person('ann2', 'Ann'),
    person('ann1', 'Ann'),
  ].map((u) => [u.id, u]),
);
const company = {
  members: () => [
    { userId: 'olivia', offboardLastDay: null }, // Admin vẫn là ứng viên
    { userId: 'pam', offboardLastDay: null }, // đã ở ws
    { userId: 'mia', offboardLastDay: '2026-11-30' }, // có lịch nghỉ ⇒ không
    { userId: 'nina', offboardLastDay: null }, // chờ kích hoạt ⇒ có
    { userId: 'lit', offboardLastDay: null },
    { userId: 'ann2', offboardLastDay: null },
    { userId: 'ann1', offboardLastDay: null },
  ], // quinn: không còn dòng (đã nghỉ) ⇒ không
};
const memberships = {
  rows: () => [
    { workspaceId: WS, userId: 'pam' },
    { workspaceId: 'ws-b', userId: 'nina' }, // ws khác không ảnh hưởng
  ],
};
const dir = new InMemoryMemberCandidates(company, { users }, memberships);
const search = (q: string, limit = 20) => dir.search({ workspaceId: WS, q, limit });

describe('InMemoryMemberCandidates', () => {
  it('người thuộc công ty, chưa có lịch nghỉ, chưa ở ws; khớp tên/email không phân biệt hoa thường', async () => {
    expect((await search('EXAMPLE')).map((u) => u.id)).toEqual([
      'ann1',
      'ann2',
      'lit',
      'nina',
      'olivia',
    ]);
    expect(await search('nIN')).toEqual([person('nina', 'Nina')]);
    expect(await search('mia')).toEqual([]);
    expect(await search('quinn')).toEqual([]);
  });

  it('%, _ và dấu gạch ngược theo nghĩa đen; sắp (tên, id); cắt ở limit', async () => {
    expect((await search('0%_x\\')).map((u) => u.id)).toEqual(['lit']);
    expect(await search('%')).toEqual([person('lit', 'Lý 100%_x\\', 'lit@example.com')]);
    expect((await search('ann', 1)).map((u) => u.id)).toEqual(['ann1']);
  });
});

describe('ListMemberCandidatesQuery', () => {
  it('cần member:add (MEMBER / VIEWER ⇒ 403); OWNER / PM ⇒ tìm trong ws của actor, tối đa 20', async () => {
    const calls: unknown[] = [];
    const query = new ListMemberCandidatesQuery({
      candidates: { search: (input) => (calls.push(input), Promise.resolve([])) },
    });
    for (const role of ['MEMBER', 'VIEWER'] as const) {
      await expect(
        query.execute({ userId: 'u', workspaceId: WS, role }, { q: 'an' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    for (const role of ['OWNER', 'PM'] as const) {
      await query.execute({ userId: 'u', workspaceId: WS, role }, { q: 'an' });
    }
    expect(calls).toEqual([
      { workspaceId: WS, q: 'an', limit: 20 },
      { workspaceId: WS, q: 'an', limit: 20 },
    ]);
  });
});
