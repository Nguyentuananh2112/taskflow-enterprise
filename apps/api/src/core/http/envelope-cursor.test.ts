import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { envelopeOf, FakeClock } from '../../../test/support';
import { requestContext } from '../context/request-context';
import { ResourceNotFoundError, ValidationError } from '../errors';
import { decodeCursor, encodeCursor } from './cursor';
import { HttpResponder } from './envelope';

const clock = new FakeClock('2026-10-15T08:00:00.000Z');
const responder = new HttpResponder(clock);

describe('HttpResponder', () => {
  const app = express();
  app.use((_req, _res, next) => requestContext.run({ requestId: 'req-1' }, next));
  app.get('/one', (_req, res) => responder.ok(res, { id: 't1' }));
  app.get('/page', (_req, res) =>
    responder.ok(res, [1, 2], { nextCursor: 'c', hasMore: true, limit: 2 }),
  );
  app.post('/new', (_req, res) => responder.created(res, { id: 'n' }));

  it('ok: 200 + envelope có timestamp từ clock và requestId từ ngữ cảnh', async () => {
    const res = await request(app).get('/one');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: 't1' },
      meta: { timestamp: '2026-10-15T08:00:00.000Z', requestId: 'req-1' },
    });
  });

  it('ok với page ⇒ meta.page', async () => {
    const res = await request(app).get('/page');
    expect(envelopeOf(res).meta.page).toEqual({ nextCursor: 'c', hasMore: true, limit: 2 });
  });

  it('created ⇒ 201', async () => {
    expect((await request(app).post('/new')).status).toBe(201);
  });

  it('errorBody: code/message/details + meta; ngoài request ⇒ requestId null', () => {
    expect(responder.errorBody(new ResourceNotFoundError('task'))).toEqual({
      success: false,
      error: {
        code: 'RESOURCE_NOT_FOUND',
        message: 'Không tìm thấy tài nguyên.',
        details: { resource: 'task' },
      },
      meta: { timestamp: '2026-10-15T08:00:00.000Z', requestId: null },
    });
  });
});

describe('cursor', () => {
  const Keys = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });
  const keys = {
    createdAt: '2026-10-15T08:00:00.000Z',
    id: '0199e5a2-7c1e-7cc3-9a3b-1f2e3d4c5b6a',
  };

  it('encode → decode khứ hồi, chuỗi base64url opaque', () => {
    const cursor = encodeCursor('tasks', keys);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, 'tasks', Keys)).toEqual(keys);
  });

  it.each([
    ['dùng cho endpoint khác (kind lệch)', encodeCursor('members', keys)],
    ['không phải base64 JSON', 'not-a-cursor!!'],
    ['JSON nhưng sai cấu trúc', Buffer.from('[1,2]').toString('base64url')],
    ['JSON null', Buffer.from('null').toString('base64url')],
    ['khóa sai kiểu', encodeCursor('tasks', { createdAt: 'x', id: 1 })],
  ])('từ chối cursor %s ⇒ VALIDATION_ERROR trên path cursor', (_label, raw) => {
    try {
      decodeCursor(raw, 'tasks', Keys);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).issues).toEqual([
        { path: ['cursor'], code: 'invalid_cursor', message: expect.any(String) as string },
      ]);
    }
  });
});
