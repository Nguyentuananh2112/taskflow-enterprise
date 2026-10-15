import { describe, expect, it } from 'vitest';

import { CreateProjectBody, KeyPrefix, ListProjectsQuery, UpdateProjectBody } from '../index';

describe('KeyPrefix (R17)', () => {
  it.each(['TF', 'WEB', 'A1', 'ABCDEFGHIJ'])('chấp nhận %s', (k) =>
    expect(KeyPrefix.safeParse(k).success).toBe(true),
  );
  it.each(['T', 'tf', '1TF', 'ABCDEFGHIJK', 'T-F'])('từ chối %s', (k) =>
    expect(KeyPrefix.safeParse(k).success).toBe(false),
  );
});

describe('project body/query', () => {
  it('CreateProjectBody: description rỗng ⇒ null, quá 2000 ⇒ lỗi', () => {
    expect(CreateProjectBody.parse({ name: 'P', keyPrefix: 'TF', description: ' ' })).toEqual({
      name: 'P',
      keyPrefix: 'TF',
      description: null,
    });
    expect(
      CreateProjectBody.safeParse({ name: 'P', keyPrefix: 'TF', description: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });
  it('UpdateProjectBody: keyPrefix bất biến ⇒ field lạ; cần ít nhất một trường', () => {
    expect(UpdateProjectBody.safeParse({ keyPrefix: 'NEW' }).success).toBe(false);
    expect(UpdateProjectBody.safeParse({}).success).toBe(false);
    expect(UpdateProjectBody.safeParse({ description: null }).success).toBe(true);
  });
  it('ListProjectsQuery: archived mặc định "false"', () => {
    expect(ListProjectsQuery.parse({})).toEqual({ archived: 'false', limit: 50 });
    expect(ListProjectsQuery.safeParse({ archived: 'yes' }).success).toBe(false);
  });
});
