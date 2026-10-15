import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../core/errors';
import { Membership } from './membership';
import { WORKSPACE_PURGE_GRACE_MS, Workspace } from './workspace';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const LATER = new Date('2026-11-02T00:00:00.000Z');
const create = () => Workspace.create({ id: 'ws1', name: ' Acme ', slug: 'acme', now: NOW });

describe('Workspace', () => {
  it('create: trim tên, chưa xóa', () => {
    expect(create().toSnapshot()).toEqual({
      id: 'ws1',
      name: 'Acme',
      slug: 'acme',
      deletedAt: null,
      purgeAt: null,
      deletedById: null,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('create với slug sai định dạng ⇒ ValidationError (slug do application đã chọn vẫn được kiểm lại)', () => {
    expect(() => Workspace.create({ id: 'w', name: 'A', slug: 'Bad Slug', now: NOW })).toThrow(
      ValidationError,
    );
  });

  it('rename / changeSlug cập nhật updatedAt; kiểm hợp lệ', () => {
    const ws = create();
    ws.rename('  New ', LATER);
    ws.changeSlug('new-slug', LATER);
    expect(ws.toSnapshot()).toMatchObject({ name: 'New', slug: 'new-slug', updatedAt: LATER });
    expect(() => ws.changeSlug('Beta', LATER)).toThrow(ValidationError);
    expect(() => ws.rename('', LATER)).toThrow(ValidationError);
  });

  it('softDelete: deletedAt = now, purgeAt = now + 30 ngày, deletedById (WSD-01)', () => {
    const ws = create();
    ws.softDelete('alice', NOW);
    expect(WORKSPACE_PURGE_GRACE_MS).toBe(30 * 86_400_000);
    expect(ws.toSnapshot()).toMatchObject({
      deletedAt: NOW,
      purgeAt: new Date(NOW.getTime() + WORKSPACE_PURGE_GRACE_MS),
      deletedById: 'alice',
    });
    expect(ws.isDeleted).toBe(true);
  });

  it('isRestorable: chỉ khi đã xóa và purgeAt > now (WSR-03/04)', () => {
    const ws = create();
    expect(ws.isRestorable(NOW)).toBe(false);
    ws.softDelete('alice', NOW);
    expect(ws.isRestorable(new Date(NOW.getTime() + WORKSPACE_PURGE_GRACE_MS - 1))).toBe(true);
    expect(ws.isRestorable(new Date(NOW.getTime() + WORKSPACE_PURGE_GRACE_MS))).toBe(false);
  });
});

describe('Membership', () => {
  it('changeRole trả true khi đổi, false khi giữ nguyên (ROL-08)', () => {
    const m = Membership.create({
      id: 'm1',
      workspaceId: 'ws1',
      userId: 'u1',
      role: 'MEMBER',
      now: NOW,
    });
    expect(m.changeRole('MEMBER', LATER)).toBe(false);
    expect(m.toSnapshot().updatedAt).toEqual(NOW);
    expect(m.changeRole('VIEWER', LATER)).toBe(true);
    expect(m.toSnapshot()).toMatchObject({ role: 'VIEWER', updatedAt: LATER });
  });

  it('reconstitute giữ nguyên trạng thái', () => {
    const snap = Membership.create({
      id: 'm1',
      workspaceId: 'ws1',
      userId: 'u1',
      role: 'OWNER',
      now: NOW,
    }).toSnapshot();
    expect(Membership.reconstitute(snap).toSnapshot()).toEqual(snap);
  });
});
