import { loadEnv } from './config/env';
import { createServer } from './server';

const env = loadEnv();
const server = createServer(env).listen(env.PORT, () => {
  console.info(`[api] listening on :${env.PORT} (${env.NODE_ENV})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
