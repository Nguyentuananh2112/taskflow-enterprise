# G1: Cross-read of the workspace module (API) from the frontend contract side

Reader: E (Frontend) · 2026-10-16 · base main `fc75215` · read-only, nothing run.
Scope: `apps/api/src/modules/workspace/**` (routes, use cases, errors, realtime notifier calls) + `packages/contracts/src/{workspace,project,realtime}` compared with what `apps/web` does with them (forms, mutations, socket handlers, mock API).

**Summary:** the contract matches — every error code/`details` shape the API emits for workspace/project/member routes is one the web handles, and the 3 realtime events (`member:role-changed`, `workspace:access-revoked`, `project:updated`) are parsed with the contract schemas. No High/Medium findings. Below: 4 Low (W1–W4, all fixes on the web side, owner E) + 3 Info (I1 web docs, I2 mock, I3 API decision for B/Tech Lead).

## What was checked and matches (no finding)

| Contract point | API | Web |
|---|---|---|
| 409 slug / keyPrefix | `CONFLICTS` in `infrastructure/persistence/prisma/db.ts` + `slugConflict()` (reserved slug = same error) ⇒ `{ reason: 'taken', field }` | `applyServerErrors` reads `ResourceConflictDetails.field` ⇒ field error (`workspace-general-form`, `create-project-form`) |
| Add member: unknown email 404 `user` / already a member 409 `already_member` | `add-member.use-case.ts`, `db.ts` | `add-member-form.tsx:50` — one generic message for both (security.md §6.5, no enumeration) |
| 422 `LAST_OWNER` | `owner-guard.ts` ⇒ `BUSINESS_RULE_VIOLATION` + `details.rule` | `member-errors.ts` parses `BusinessRuleDetails.rule` |
| 422 `PROJECT_ARCHIVED` on PATCH project | `Project.update` | `project-general-form.tsx:47` |
| Delete ws: 400 `confirmSlug` mismatch, 409 version race, 404 deleted elsewhere | `delete-workspace.use-case.ts`, `optimistic-save.ts` | `use-delete-workspace.ts` + `delete-workspace-section.tsx` (refetch slug, clear input / toast + `/w`) |
| Restore: every failure = one 404 `workspace`; no socket | `restore-workspace.use-case.ts` | `deleted-workspaces.tsx` one message; `onSettled` refetches list/deleted/me |
| `member:role-changed` `{ workspaceId, role }` to the target's user room | `gateway.ts:163` | `use-realtime-session.ts`: patches `myRole` in detail, invalidates me/members/list |
| `workspace:access-revoked` `{ workspaceId }` (removed member, and every member on ws soft delete) | `gateway.ts:152,173` | removes ws cache, `/w` if inside it, no double toast for own `originClientId` |
| `project:updated` `{ project: ProjectDto }` after commit, only when written | `update-project`, `set-project-archived` | `use-board-realtime.ts:69` sets project detail (archived banner/lock follow) |
| Order 401 → 400 params → 404 tenant → 403 → 400 body | `workspace.routes.ts` | all list/settings views treat 404 as "Không tìm thấy hoặc không có quyền" (ADR-020) |

## Findings

### W1 — Low — every 404 from a member action is shown as "this person is no longer in the workspace"
- API: member routes can 404 with `details.resource = 'user'` (target gone — `owner-guard.ts:22`) **or** `'workspace'` (the caller lost membership in the meantime — X6 `lockOwnersAndReloadActor`, `owner-guard.ts:39`; or ws deleted — X7 `assertWorkspaceLive`, `workspace-guard.ts:14`; or `loadMembership`).
- Web: `apps/web/src/entities/member/model/member-errors.ts:14` maps any `RESOURCE_NOT_FOUND` to "Người này không còn trong workspace".
- Scenario: OWNER A is on the members page; B (another OWNER) removes A; A's socket is down (reconnecting), A clicks "Xóa" on C ⇒ 404 `workspace` ⇒ toast says C is gone, A stays on a page of a workspace they no longer belong to. (With the socket up, `workspace:access-revoked` already moves A to `/w`, so this is the fallback path.)
- Fix (E): branch on `NotFoundDetails.resource` — `workspace` ⇒ same handling as `workspace:access-revoked` (remove ws cache, `/w`, "Bạn không còn truy cập được workspace này"); `user` ⇒ current message.

### W2 — Low — remove member: failed request does not refresh the table
- `features/member-remove/ui/remove-member-button.tsx` invalidates `memberKeys` only in `onSuccess`; `role-select.tsx` does it in `onSettled`.
- Scenario: C was already removed in another tab ⇒ 404 `user` ⇒ toast "không còn trong workspace" but C's row stays until the 60 s stale time / reload; clicking again repeats the error.
- Fix (E): invalidate `memberKeys.all(wsId)` in `onSettled` (as role-select).

### W3 — Low — workspace/project settings forms show "reload and retry" but don't reload
- API: PATCH workspace ‖ DELETE and PATCH project ‖ archive race ⇒ 409 `VERSION_CONFLICT` (ADR-110, `optimistic-save.ts`); PATCH an archived project ⇒ 422 `PROJECT_ARCHIVED`.
- Web: `workspace-general-form.tsx` and `project-general-form.tsx` put the message in the form root but never invalidate `workspaceKeys.detail` / `projectKeys.detail`. For `PROJECT_ARCHIVED` the settings page keeps showing "Lưu trữ dự án" (not "Khôi phục") for an already archived project, so the suggested action ("khôi phục trước khi sửa") is not reachable without a manual reload. `use-delete-workspace.ts` already does the right thing for its 409.
- Fix (E): on `VERSION_CONFLICT` / `PROJECT_ARCHIVED` / 404 invalidate the detail query (the tasks side already does this via `entities/project/@x/task.ts`).

### W4 — Low — `project:updated` applied without ordering
- Contract: `ProjectDto` has no `version` (only `updatedAt`, `project.schemas.ts:53`); events are emitted per request after commit, so two quick writes from different requests/instances (rename by A, archive by B) can arrive in either order.
- Web: `use-board-realtime.ts:69-72` overwrites the project detail with whichever event arrives last ⇒ the board can show "not archived" (drag enabled) after an archive until the next refetch; the server still rejects writes with 422, so it is a UX glitch, not a data issue.
- Fix (E, no contract change): ignore an event whose `project.updatedAt` is older than the cached one. Alternative (C/B): add `version` to `ProjectDto` like tasks.

## Info

- **I1 (web docs, E):** `member:role-changed` and `project:updated` reach only the affected user / the board room. Other admins' member tables, the project list (archived tab) and project settings pages are not live — they rely on `staleTime` 60 s / refetch on focus. Consistent with the current design; worth one line in `frontend.md` §3.5 so nobody expects it.
- **I2 (web mock, E):** `apps/web/src/app/mock-api/member-handlers.ts:89` returns `already_member` with `field: 'email'`; the real API returns `{ reason: 'already_member' }` with no `field` (`db.ts` `CONFLICTS`). The add-member form handles both the same, but a future form relying on `applyServerErrors` would pass on the mock and behave differently on the real API. Align the mock.
- **I3 (API decision, B / Tech Lead):** `PATCH /workspaces/:wsId` and `PATCH …/projects/:projectId` take no client version, so ADR-110 only guards the read→write window inside one transaction. Two OWNERs editing the workspace name/slug (or two PMs a project description) ⇒ last write wins silently. Acceptable for v1 settings screens in my view (rare, low value), but it should be an explicit accepted risk rather than an implicit one; if not accepted, add `version` to the body + DTO (contract change).

## Proposal
W1–W4 + I1 + I2 are web code owned by E — I can fix them in one small branch (`fix/G1-workspace-fe`) with tests, ~1–2 h, no machine-heavy steps except the usual `pnpm verify` + build. I3 needs a decision from B / Tech Lead.
