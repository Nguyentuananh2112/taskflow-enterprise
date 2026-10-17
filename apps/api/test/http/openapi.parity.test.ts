// A2: OpenAPI sinh từ contracts PHẢI khớp router Express thật — mọi route trong router có trong spec và
// ngược lại. Thêm route mà quên danh mục (hoặc ngược lại) ⇒ test này đỏ (CI).
import { API_ROUTES } from '@taskflow/contracts/openapi';
import type { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { appConfigFromEnv } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { productionEnvVars, testEnvVars } from '../support';
import { createTestApp } from '../support/http-app';

interface RouteLayer {
  route?: { path: string | string[]; methods: Record<string, boolean | undefined> };
}

/** `/:wsId/x` ⇒ `/{wsId}/x`; bỏ `/` thừa ở cuối. */
const toOpenApiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}').replace(/\/+$/, '') || '/';

function routesOf(mounted: readonly { path: string; router: Router }[]): string[] {
  const found: string[] = [];
  for (const { path: base, router } of mounted) {
    for (const layer of router.stack as unknown as RouteLayer[]) {
      if (!layer.route) continue;
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const leaf of paths) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled && method !== '_all') {
            found.push(`${method} ${toOpenApiPath(`${base}${leaf === '/' ? '' : leaf}`)}`);
          }
        }
      }
    }
  }
  return found.sort();
}

/**
 * T-061 TẠM (apps/api/tsconfig.exclusions.json): route attendance cấp ws còn trong danh mục nhưng router đã gỡ (A,
 * T-063); route `/leave/*` cấp công ty (T-064) đã trong danh mục nhưng container chỉ gắn leave khi dựng được lịch của
 * attendance (T-063). XÓA bộ lọc này khi T-063 gắn cả hai.
 */
const PENDING_T063 = /^(\/workspaces\/\{wsId\}\/attendance|\/leave)(\/|$)/;

describe('OpenAPI ↔ router thật (A2)', () => {
  it('mọi route của router có trong danh mục OpenAPI và ngược lại (không thiếu, không thừa)', () => {
    const { container } = createTestApp();
    const actual = routesOf(container.routers);
    const documented = API_ROUTES.filter((r) => !PENDING_T063.test(r.path))
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(actual.length).toBeGreaterThan(20);
    expect(actual).toEqual(documented);
  });

  it('GET /api/docs trả spec OpenAPI 3.1 khi bật (local/test); không bật ⇒ 404', async () => {
    const on = await request(createTestApp({ apiDocs: true }).app).get('/api/docs');
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ openapi: '3.1.0', info: { title: 'TaskFlow API' } });
    expect(Object.keys((on.body as { paths: object }).paths)).toContain('/auth/login');
    expect((await request(createTestApp().app).get('/api/docs')).status).toBe(404);
  });

  it('appConfigFromEnv: apiDocs CHỈ ở APP_ENV local/test — staging/production không lộ', () => {
    expect(appConfigFromEnv(loadEnv(testEnvVars({ APP_ENV: 'local' }))).apiDocs).toBe(true);
    expect(appConfigFromEnv(loadEnv(testEnvVars({ APP_ENV: 'test' }))).apiDocs).toBe(true);
    for (const appEnv of ['staging', 'production']) {
      expect(appConfigFromEnv(loadEnv(productionEnvVars({ APP_ENV: appEnv }))).apiDocs).toBe(false);
    }
  });
});
