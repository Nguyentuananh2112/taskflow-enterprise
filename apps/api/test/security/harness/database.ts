import { randomBytes } from 'node:crypto';

import pg from 'pg';

import type { SecurityHarnessConfig } from './config';

/** DB tạm cho một lần chạy suite: clone từ template, xóa khi xong (không bao giờ `migrate reset`). */
export interface EphemeralDatabase {
  name: string;
  appUrl: string;
  drop(): Promise<void>;
}

async function withAdmin<T>(adminUrl: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function createEphemeralDatabase(
  config: SecurityHarnessConfig,
): Promise<EphemeralDatabase> {
  const name = `taskflow_sec_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const ident = (value: string) => `"${value.replaceAll('"', '""')}"`;

  await withAdmin(config.adminUrl, (client) =>
    client.query(`CREATE DATABASE ${ident(name)} TEMPLATE ${ident(config.templateDb)}`),
  );

  const appUrl =
    `postgresql://${encodeURIComponent(config.appUser)}:${encodeURIComponent(config.appPassword)}` +
    `@${config.pgHost}:${config.pgPort}/${name}`;

  return {
    name,
    appUrl,
    drop: () =>
      withAdmin(config.adminUrl, (client) =>
        client.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`),
      ).then(() => undefined),
  };
}
