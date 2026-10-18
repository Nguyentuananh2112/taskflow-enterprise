// Public API của @taskflow/contracts — gói "Just-in-Time": exports trỏ thẳng source .ts,
// Next 16 (Turbopack) tự transpile, API dùng tsx khi dev và tsdown inline khi build.
// Thiết kế: docs/design/data-and-api.md §5. Không chứa logic domain (§5.3).
// Có subpath (`@taskflow/contracts/task`, …) trong package.json "exports" để import gọn/tree-shake.
export * from './common';
export * from './rbac/permissions';
export * from './auth/auth.schemas';
export * from './workspace';
export * from './project/project.schemas';
export * from './task';
export * from './attendance';
export * from './audit/audit.schemas';
export * from './realtime/events';
export * from './hr/hr.schemas';
export * from './leave';
export * from './company';
export * from './chat';
export * from './system/healthz.schemas';
