import type { CompanyGrant, CompanyRole } from '../../domain/roles';

/** Thông báo khi Admin đổi role / grant của một người (T-061a) — adapter ở composition (notifications + realtime). */
export interface ICompanyAccessEvents {
  /** TRONG transaction: thông báo bền `ACCESS_CHANGED` cho người bị đổi (refId = userId), không chép quyền. */
  accessChanged(q: { userId: string; actorId: string }): Promise<void>;
  /** SAU commit: `company:access-changed {role, grants}` tới `user:{id}` — web làm mới menu / cache ngay. */
  pushAccessChanged(q: {
    userId: string;
    role: CompanyRole;
    grants: readonly CompanyGrant[];
    actorId: string;
  }): Promise<void>;
}
