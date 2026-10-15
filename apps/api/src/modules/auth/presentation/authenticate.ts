import type { RequestHandler } from 'express';

import type { AccessTokenAuthenticator } from '../application/access-token-authenticator';

/**
 * Middleware `authenticate` (security.md §2.5): verify access token + `tv` + `sid`, gắn `req.user`
 * có kiểu (ADR-014). Lỗi (`UNAUTHORIZED` / `TOKEN_EXPIRED` / `SERVICE_UNAVAILABLE`) đi qua error handler.
 */
export function createAuthenticate(
  authenticator: Pick<AccessTokenAuthenticator, 'authenticate'>,
): RequestHandler {
  return async (req, _res, next) => {
    const user = await authenticator.authenticate(req.headers.authorization);
    req.user = { id: user.id, sid: user.sid };
    next();
  };
}
