import type { Store } from 'express-rate-limit';
import type { Express, Router } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from '../app';
import type { IClock, IIdGenerator, IRandom } from '../core/domain';
import type { ReadinessProbe } from '../core/http/health';
import type { RateLimitRule } from '../core/http/rate-limit/rules';
import type { AuthModule } from '../modules/auth/auth.module';
import type { IAccessTokenService } from '../modules/auth/application/ports/access-token-service.port';
import type { IPasswordHasher } from '../modules/auth/application/ports/password-hasher.port';
import type { PasswordPolicy } from '../modules/auth/domain/password-policy';
import type { NotificationsModule } from '../modules/notifications/notifications.module';
import type { CompanyModule } from '../modules/company/company.module';
import type { AttendanceModule } from '../modules/attendance/attendance.module';
import type { LeaveModule } from './leave-wiring';
import type { TaskModule } from '../modules/task/task.module';
import type { WorkspaceModule } from '../modules/workspace/workspace.module';
import type { AppMetrics } from '../core/observability/metrics';
import type { IErrorReporter } from '../core/observability/sentry';
import type { LateBoundRealtime } from './late-realtime';
import type { Persistence } from './persistence';
import type { ISocketAuthenticator } from '../core/realtime/ports';
import type { FilesBundle } from './files-setup';
import type { ChatSettings } from './chat-wiring';

export interface ContainerConfig extends AppConfig {
  cookieSecure: boolean;
  jwtSecret: string;
  jwtPreviousSecret?: string | undefined;
  /** Chỉ APP_ENV=test (env.ts chặn nơi khác); thiếu ⇒ 900 giây. */
  jwtAccessTtlSeconds?: number | undefined;
}

export interface ContainerDeps {
  config: ContainerConfig;
  logger: Logger;
  clock: IClock;
  /**
   * Giờ NGHIỆP VỤ (attendance, leave, notifications, workspace — workDate, "hôm nay", serverNow, createdAt, joinedAt /
   * leftAt của nhiệm kỳ). Thiếu ⇒ `clock`. Chỉ E2E đặt khác (TEST_CLOCK_ANCHOR, APP_ENV=test — anchored-clock.ts);
   * auth/JWT, task, rate limit, meta.timestamp, socket luôn theo `clock` (giờ thật).
   */
  businessClock?: IClock;
  /**
   * T-047: mốc lưu dữ liệu chấm công (`YYYY-MM-DD`) — `retentionCutoffFor` của maintenance-setup, CHỈ khác null khi job
   * retention thật sự bật. Thiếu ⇒ không áp (test HTTP, chế độ bộ nhớ).
   */
  retentionCutoff?: () => string | null;
  ids: IIdGenerator;
  random: IRandom;
  hasher: IPasswordHasher;
  policy: PasswordPolicy;
  persistence: Persistence;
  /** Store rate limit cho từng rule (Valkey ở production — ADR-063; bộ nhớ trong test). */
  rateLimitStore: (rule: RateLimitRule) => Store;
  probes: readonly ReadinessProbe[];
  isShuttingDown: () => boolean;
  accessTokens?: IAccessTokenService;
  /** Observability (T-035) — thiếu ⇒ không đo / không báo Sentry (test). */
  metrics?: AppMetrics;
  errorReporter?: IErrorReporter;
  /** Mốc 6 (ADR-141): kho tệp + `/media` — thiếu ⇒ không gắn `/media` (test HTTP cũ). */
  files?: FilesBundle;
  /** Mốc 6 (T-069): cửa sổ sửa / hạn mức chat chỉnh được ở APP_ENV=test. */
  chat?: ChatSettings;
}

export interface Container {
  app: Express;
  auth: AuthModule;
  workspace: WorkspaceModule;
  task: TaskModule;
  /** Thông báo bền (ADR-123): `publisher` nối vào port của leave / attendance / workspace. */
  notifications: NotificationsModule;
  /** Mốc 3.5: công ty — quyền / nhiệm kỳ / HrAuditLog cho attendance, leave, payroll (nối khi gỡ loại tạm). */
  company: CompanyModule;
  /** Chấm công cấp công ty (T-063). */
  attendance: AttendanceModule;
  /** Nghỉ phép cấp công ty (T-064). */
  leave: LeaveModule;
  /** Authenticator của gateway Socket.io: access token (auth) + cổng công ty (HIGH-2). */
  socketAuth: ISocketAuthenticator;
  /** Gắn gateway Socket.io sau khi có HTTP server: `realtime.bind(gateway)`. */
  realtime: LateBoundRealtime;
  /** Router module gắn dưới `/api/v1` + đường dẫn gắn — cho test parity OpenAPI (A2). */
  routers: readonly { path: string; router: Router }[];
}
