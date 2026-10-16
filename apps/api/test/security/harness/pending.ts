/**
 * Ca SEC đã có thân test nhưng CHƯA chạy được vì tính năng chưa làm — danh sách DUY NHẤT được phép
 * skip. Mỗi mục bắt buộc có lý do + ticket. Ca không có ở đây ⇒ chạy mặc định (local lẫn CI).
 *
 * `skip-budget-reporter.ts` làm lượt chạy ĐỎ nếu có ca bị skip mà không khai báo ở đây (kể cả skip
 * động bằng `ctx.skip()` — vd build từ chối khởi động, probe không thấy limiter/gateway). Trước đây
 * mọi ca `pendingRoute` đều skip khi thiếu `SEC_RUN_PENDING` ⇒ CI không chạy 44 ca dù route đã có.
 *
 * Nghiệm thu branch làm tính năng: `SEC_RUN_PENDING=all` hoặc danh sách ticket/id (vd `T-040,SEC-28`).
 * Tính năng merge ⇒ XÓA mục khỏi đây trong cùng PR.
 */
export interface DeclaredPending {
  readonly reason: string;
  readonly ticket: string;
}

export const DECLARED_PENDING: Readonly<Record<string, DeclaredPending>> = {
  // T-042 (F): bộ HR viết trước route. Vé merge ⇒ xóa các mục của vé đó (SEC_RUN_PENDING=<ticket> để nghiệm thu). T-037 đã merge (e0b0fc9), T-038 gate xanh (0fb023f), T-039 gate xanh (87255e8) — mục của ba vé đã gỡ.
  'SEC-HR-15': {
    ticket: 'T-040',
    reason: 'Mốc 3 chưa có module notifications (viết trước theo attendance-leave.md §5/§9)',
  },
  'SEC-HR-17': {
    ticket: 'T-040',
    reason: 'Mốc 3 chưa có module notifications (viết trước theo attendance-leave.md §5/§9)',
  },
  'SEC-HR-18': {
    ticket: 'T-040',
    reason: 'Mốc 3 chưa có module notifications (viết trước theo attendance-leave.md §5/§9)',
  },
  'SEC-HR-19': {
    ticket: 'T-040',
    reason: 'Mốc 3 chưa có module notifications (viết trước theo attendance-leave.md §5/§9)',
  },
  'SEC-HR-20': {
    ticket: 'T-040',
    reason: 'Mốc 3 chưa có module notifications (viết trước theo attendance-leave.md §5/§9)',
  },
};

/** Tiền tố tên ca skip hợp lệ: `[PENDING <ticket>] <id> — <title>` (reporter đọc id sau `] `). */
export const PENDING_PREFIX = '[PENDING ';

/**
 * Ca SEC CHƯA có thân — NỢ THẬT của ma trận SEC (BACKLOG F4), id → file. Ca đã phủ ở tầng khác KHÔNG
 * nằm ở đây mà ở `OUT_OF_SCOPE`.
 * Reporter đỏ nếu (a) có todo KHÔNG nằm ở đây (một ca vừa bị xóa thân / bọc `it.todo` ⇒ mất kiểm mà suite
 * vẫn xanh — review B), hoặc (b) id ở đây không còn là todo trong file đã chạy (viết thân xong ⇒ xóa mục
 * trong cùng PR để danh sách trung thực). Chỉ được THÊM mục khi thêm ca mới chưa viết, có review.
 */
export const TODO_BUDGET: Readonly<Record<string, string>> = {
  // T-042: SEC-HR-23 cần process API riêng hops=0. (CC-HR-13 đã có thân sau T-038/T-039.)
  'SEC-HR-23': 'hr.sec.ts',
};

export interface OutOfScopeCase {
  /** File `.sec.ts` khai báo ca (`outOfScope(id, title, coveredBy)`). */
  readonly file: string;
  /** Nhãn tầng phủ — phải trùng tham số `where` của `outOfScope` (tên ca `[coveredBy] id — …`). */
  readonly coveredBy: string;
  /** Đường dẫn (từ gốc repo) tới test thật phủ ca này; file phải tồn tại và chứa `marker ?? id`. */
  readonly ref: string;
  /** Mã test-spec của ca phủ (vd `WSR-05`) khi file đó không nhắc id SEC — mặc định = id. */
  readonly marker?: string;
}

/**
 * Ca SEC kiểm ở tầng khác (E2E, unit…) — chỉ liệt kê để ma trận SEC đủ. Reporter đỏ nếu tên ca không
 * khớp `coveredBy`, `ref` không tồn tại / không chứa id (con trỏ chết ⇒ thực ra không ai kiểm), hoặc mục
 * ở đây không còn là ca `outOfScope` trong file đã chạy.
 */
export const OUT_OF_SCOPE: Readonly<Record<string, OutOfScopeCase>> = {
  'SEC-24d': {
    file: 'auth.sec.ts',
    coveredBy: 'unit: logout-all.use-case.test.ts ALL-05 / ADR-105',
    ref: 'apps/api/src/modules/auth/application/use-cases/logout-all.use-case.test.ts',
  },
  'SEC-53': {
    file: 'tenant.sec.ts',
    coveredBy: 'integration WSR-05',
    ref: 'apps/api/test/integration/workspace/workspace-races.int.ts',
    marker: 'WSR-05',
  },
  'SEC-49': {
    file: 'auth.sec.ts',
    coveredBy: 'E2E Playwright',
    ref: 'e2e/specs/xss.e2e.ts',
  },
  // Không có API làm created_by_id NULL (cần xóa cứng user — sau v1). Chuyển về hộp đen khi có API xóa
  // tài khoản. Tech Lead duyệt 2026-10-16; B review.
  'SEC-09': {
    file: 'task.sec.ts',
    coveredBy: 'tầng I (LSP use case)',
    ref: 'apps/api/src/modules/task/application/use-cases/update-delete-task.use-case.test.ts',
  },
  'SEC-48': {
    file: 'auth.sec.ts',
    coveredBy: 'E2E Playwright',
    ref: 'e2e/specs/browser-security.e2e.ts',
  },
  'SEC-50': {
    file: 'auth.sec.ts',
    coveredBy: 'E2E Playwright',
    ref: 'e2e/specs/browser-security.e2e.ts',
  },
};
