// A2: OpenAPI sinh từ contracts PHẢI khớp router Express thật — mọi route trong router có trong spec và
// ngược lại. Thêm route mà quên danh mục (hoặc ngược lại) ⇒ test này đỏ (CI).
import { API_ROUTES } from '@taskflow/contracts/openapi';
import type { Router } from 'express';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';

import { appConfigFromEnv } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { productionEnvVars, testEnvVars } from '../support';
import { createFiles } from '../../src/composition/files-setup';
import type { ILogger } from '../../src/core/logging/logger';
import { createTestApp } from '../support/http-app';

const noop = () => undefined;
const quiet = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
} as unknown as ILogger;

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

describe('OpenAPI ↔ router thật (A2)', () => {
  it('mọi route của router có trong danh mục OpenAPI và ngược lại (không thiếu, không thừa)', async () => {
    // Mốc 6: `/me/avatar` chỉ có khi có kho tệp (production luôn có) ⇒ dựng kho tạm, pipeline tắt.
    const dir = await mkdtemp(join(tmpdir(), 'tf-openapi-files-'));
    const env = loadEnv(testEnvVars({ FILE_STORE_DIR: dir, FILES_IMAGE_PIPELINE_DISABLED: '1' }));
    const files = await createFiles({
      env,
      clock: { now: () => new Date() },
      logger: quiet,
      webOrigin: 'http://w',
    });
    onTestFinished(async () => {
      await files.close();
      await rm(dir, { recursive: true, force: true });
    });
    const { container } = createTestApp({}, { files });
    const actual = routesOf(container.routers);
    const documented = API_ROUTES.map((r) => `${r.method} ${r.path}`).sort();
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
