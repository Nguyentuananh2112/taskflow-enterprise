import express, { type Express } from 'express';
import type { HealthzResponse } from '@taskflow/contracts';

import type { Env } from './config/env';

/** Tạo ứng dụng Express (chưa listen) — test dùng trực tiếp, main.ts khởi động. */
export function createServer(env: Pick<Env, 'GIT_SHA'>): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    const body: HealthzResponse = { status: 'ok', gitSha: env.GIT_SHA };
    res.json(body);
  });

  return app;
}
