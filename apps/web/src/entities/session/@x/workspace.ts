// API chéo cho entities/workspace (quy ước FSD @x): usePermission cần id người đang xem; mất quyền
// workspace ⇒ làm mới `/auth/me` (memberships).
export { sessionKeys } from '../model/use-me';
export { useSession } from '../model/use-session';
