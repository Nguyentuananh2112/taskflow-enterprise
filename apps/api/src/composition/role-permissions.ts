import { ROLE_PERMISSIONS } from '@taskflow/contracts';

import type { IRolePermissions } from '../modules/task/application/task-actor';

/** Ma trận quyền dùng chung (contracts) — nguồn của `IRolePermissions` cho module Task. */
export const rolePermissions: IRolePermissions = {
  allows: (role, permission) => ROLE_PERMISSIONS[role].includes(permission),
};
