import { describe, expect, it } from 'vitest';

import { API_ROUTES, buildOpenApiDocument } from './index';

type Json = Record<string, unknown>;
const doc = buildOpenApiDocument({ version: 'test' }) as Json & {
  paths: Record<string, Record<string, Json>>;
};

describe('OpenAPI 3.1 sinh từ Zod contracts (A2)', () => {
  it('là OpenAPI 3.1 hợp lệ về khung: openapi, info, servers, paths, components; JSON hóa được', () => {
    expect(doc['openapi']).toBe('3.1.0');
    expect(doc['servers']).toEqual([{ url: '/api/v1' }]);
    expect(() => JSON.stringify(doc)).not.toThrow();
    expect(JSON.stringify(doc)).not.toContain('"$schema"');
  });

  it('mỗi route của danh mục có đúng một operation; operationId duy nhất', () => {
    const ids = new Set<string>();
    for (const route of API_ROUTES) {
      const operation = doc.paths[route.path]?.[route.method];
      expect(operation, `${route.method} ${route.path}`).toBeDefined();
      ids.add(String(operation?.['operationId']));
    }
    expect(ids.size).toBe(API_ROUTES.length);
    const keys = API_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('tham số path khớp {placeholder} của đường dẫn và luôn required', () => {
    for (const route of API_ROUTES) {
      const placeholders = [...route.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const params = (
        (doc.paths[route.path]?.[route.method]?.['parameters'] ?? []) as Json[]
      ).filter((p) => p['in'] === 'path');
      expect(params.map((p) => p['name']).sort(), `${route.method} ${route.path}`).toEqual(
        placeholders,
      );
      expect(params.every((p) => p['required'] === true)).toBe(true);
    }
  });

  it('body / response lấy từ schema Zod thật (vd move task cần expectedVersion; 204 không có content)', () => {
    const move =
      doc.paths['/workspaces/{wsId}/projects/{projectId}/tasks/{taskId}/move']?.['patch'];
    const body = (move?.['requestBody'] as Json)['content'] as Record<string, { schema: Json }>;
    expect(body['application/json']?.schema['required']).toContain('expectedVersion');
    const logout = doc.paths['/auth/logout']?.['post'];
    expect((logout?.['responses'] as Record<string, Json>)['204']).toEqual({
      description: 'Không có nội dung',
    });
    const listTasks = doc.paths['/workspaces/{wsId}/projects/{projectId}/tasks']?.['get'];
    const ok = (listTasks?.['responses'] as Record<string, Json>)['200'];
    expect(JSON.stringify(ok)).toContain('"nextCursor"'); // meta.page cho danh sách
  });
});
