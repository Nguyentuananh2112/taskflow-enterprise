// ADR-109: `Path=/` ⇒ cookie refresh đi kèm MỌI request tới API — phải chắc nó không lọt vào log.
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../core/logging/pino-logger';

const SECRET = 'rt-secret-value-0123456789';

function capture() {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger({ level: 'info', gitSha: 't', appEnv: 'test' }, dest), lines };
}

describe('header Cookie / Set-Cookie không vào log (ADR-109)', () => {
  it('req.headers.cookie và res.headers["set-cookie"] bị redact', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: { headers: { cookie: `__Host-tf_rt=${SECRET}` } },
        res: { headers: { 'set-cookie': [`__Host-tf_rt=${SECRET}; Path=/`] } },
      },
      'probe',
    );
    expect(lines.join('')).not.toContain(SECRET);
    expect(lines.join('')).toContain('[REDACTED]');
  });
});
