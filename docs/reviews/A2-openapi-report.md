# A2: OpenAPI 3.1 generated from the Zod contracts

Branch `feat/A2-openapi`. Backlog A2 (ADR-112).

## Done

- **`@taskflow/contracts/openapi`** (new subpath, **not** in the root barrel ⇒ the web bundle never evaluates it):
  - `routes.ts`: the `API_ROUTES` catalogue — 31 routes under `/api/v1`. Each has method, path (`{param}` form), summary, tag, security (`bearer` / `refreshCookie` / `none`), params / query / body, and response (status, `data`, `paged`). All schemas are the **existing Zod schemas** in contracts; none are written by hand. Error codes per route follow data-and-api.md §2.
  - `document.ts`: `buildOpenApiDocument({ version })` builds OpenAPI **3.1.0**, using `z.toJSONSchema` (Zod 4, draft-2020-12 — the dialect OpenAPI 3.1 uses):
    - requests use the `input` side, responses the `output` side;
    - responses are wrapped in the success envelope (`meta.page` for paged lists), with a shared `ApiError` component for errors;
    - `securitySchemes` are `bearerAuth` + `refreshCookie` (`__Host-tf_rt`); `/healthz` and `/readyz` are listed with `servers: /`.
- **API:** `GET /api/docs` returns the spec (built once). It is enabled only when `appConfigFromEnv` sets `apiDocs = APP_ENV ∈ {local, test}`, so staging/production have no such route. `AppConfig.apiDocs` is optional, so existing configs stay unchanged.
- **Parity (CI):** `apps/api/test/http/openapi.parity.test.ts` walks the **real** Express router stack (`container.routers`, which the container now returns) and requires the route set to be **exactly equal** to the catalogue, in both directions. Mutation check: dropping `post /auth/logout-all` from the catalogue ⇒ red, and the diff names that route.
- Tests in `packages/contracts/src/openapi/document.test.ts`: the spec's skeleton, one operation per route with unique `operationId`s, path params match `{placeholder}`s and are required, bodies / responses come from the real schemas (move requires `expectedVersion`, 204 has no content, lists have `nextCursor`).
- README: the "API & data" row points to `GET /api/docs`.

## Decisions I made

- Request/response bodies are inlined rather than placed in `components.schemas` (except `ApiError`). That keeps it simple and needs no `.meta({ id })` added to every schema. The spec is larger, which is acceptable for a dev-only document.
- `/api/docs` returns **JSON only** — no Swagger UI (that needs a CDN script or a bundle, which conflicts with the strict CSP). Paste the spec into any OpenAPI viewer.
- `packages/contracts/src/exports.test.ts`: `./openapi` is exempt from the rule "subpaths only re-export what the root exports", deliberately (server-only).

## DoD

`pnpm verify`: lint 0, typecheck 0, test 0, audit 0.
