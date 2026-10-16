import type { ProjectDto } from '@taskflow/contracts/project';

/**
 * `project:updated` không mang version (ProjectDto chỉ có `updatedAt`) và event của các request khác
 * nhau có thể đến lệch thứ tự ⇒ bỏ event CŨ HƠN bản đang có. Bằng nhau (2 lần ghi cùng ms) ⇒ nhận
 * bản đến sau (G1 W4, ý kiến B).
 */
export function isStaleProjectEvent(cached: ProjectDto | undefined, incoming: ProjectDto): boolean {
  return cached !== undefined && Date.parse(incoming.updatedAt) < Date.parse(cached.updatedAt);
}
