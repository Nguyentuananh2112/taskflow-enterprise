import { applyVietnameseZodLocale } from '@taskflow/contracts';
import { MemoryStore } from 'express-rate-limit';
import request, { type Response } from 'supertest';

import { createContainer, type ContainerConfig } from '../../src/composition/container';
import { createMemoryPersistence } from '../../src/composition/persistence';
import { toLocal } from '../../src/core/domain/local-time';
import { ResourceConflictError } from '../../src/core/errors';
import { AnchoredClock } from '../../src/core/infrastructure/anchored-clock';
import { CryptoRandom } from '../../src/core/infrastructure/system';
import { createLogger } from '../../src/core/logging/pino-logger';
import type { DestinationStream } from 'pino';
import { Email } from '../../src/modules/auth/domain/email';
import { PasswordPolicy } from '../../src/modules/auth/domain/password-policy';
import { User } from '../../src/modules/auth/domain/user';
import { DEFAULT_COMPANY_TIME_ZONE } from '../../src/modules/company/domain/company-member';
import { FakePasswordHasher } from '../../src/modules/auth/testing/fakes';
import { envelopeOf } from './http';
import { FakeClock, SequentialIdGenerator } from './time-and-ids';

export const WEB = 'http://localhost:3001';
export const PASSWORD = 'correct-horse-12';
export const NOW = '2026-11-01T00:00:00.000Z';

/**
 * App HTTP đầy đủ (composition root thật) trên lưu trữ InMemory — dùng cho test tầng route.
 * Hasher giả cho nhanh (argon2 thật có test riêng ở T-013); JWT, cookie, rate limit, policy thật.
 */
export function createTestApp(
  overrides: Partial<ContainerConfig> = {},
  /** Ghi log ra stream này (mức info) thay vì im lặng — test kiểm nội dung log (T-032). */
  options: {
    logDestination?: DestinationStream;
    /** Như TEST_CLOCK_ANCHOR: giờ nghiệp vụ neo vào mốc này, trôi theo `clock` (giờ thật giả lập). */
    businessAnchor?: string;
  } = {},
) {
  applyVietnameseZodLocale();
  const clock = new FakeClock(NOW);
  const businessClock = options.businessAnchor
    ? new AnchoredClock(new Date(options.businessAnchor), clock)
    : clock;
  const logger = createLogger(
    { level: options.logDestination ? 'info' : 'silent', gitSha: 'test', appEnv: 'test' },
    options.logDestination,
  );
  const persistence = createMemoryPersistence(logger);
  const stores = new Map<string, MemoryStore>();
  const ids = new SequentialIdGenerator();
  const hasher = new FakePasswordHasher();
  const container = createContainer({
    config: {
      gitSha: 'test',
      corsOrigins: [WEB],
      trustProxyHops: 1,
      production: false,
      hsts: false,
      bodyLimit: '100kb',
      cookieSecure: false,
      jwtSecret: 'test-only-jwt-secret-0123456789abcdef',
      ...overrides,
    },
    logger,
    clock,
    businessClock,
    ids,
    random: new CryptoRandom(),
    hasher,
    policy: new PasswordPolicy(new Set(['password123456'])),
    persistence,
    rateLimitStore: (rule) => {
      const store = stores.get(rule.id) ?? new MemoryStore();
      stores.set(rule.id, store);
      return store;
    },
    probes: [],
    isShuttingDown: () => false,
  });
  const app = container.app;

  /** Mỗi người dùng test đi từ một IP riêng ⇒ không chạm rate limit theo IP của nhau. */
  let ipSeq = 0;
  const nextIp = () => `198.51.100.${++ipSeq}`;

  const companyStore = persistence.companyStore;
  if (!companyStore) throw new Error('createTestApp: persistence bộ nhớ phải có companyStore');

  /**
   * Mốc 3.5 (ADR-137): KHÔNG còn `/auth/register`. Helper in-process (TL chấp nhận — không phải hộp đen) tạo
   * user + dòng `company_members` + (mặc định) workspace mặc định NGAY trong store, rồi ĐĂNG NHẬP THẬT qua HTTP ⇒
   * trả cùng hình dạng như register cũ (token, cookie, workspaceId). Đường hộp đen hire → activate: suite security.
   */
  async function register(
    fullName: string,
    email = `${fullName.toLowerCase()}@example.com`,
    opts: {
      role?: 'ADMIN' | 'EMPLOYEE';
      grants?: ('HR_MANAGE' | 'PAYROLL_MANAGE')[];
      /** false ⇒ không tạo workspace mặc định (`workspaceId` = ''). */
      workspace?: boolean;
    } = {},
  ) {
    const role = opts.role ?? 'EMPLOYEE';
    const passwordHash = await hasher.hash(PASSWORD);
    const { userId, workspaceId } = await persistence.uow.run(async () => {
      const user = User.register({
        id: ids.next(),
        email: Email.create(email),
        passwordHash,
        fullName,
        now: clock.now(),
      });
      await persistence.auth.users.add(user);
      await companyStore!.insert({
        userId: user.id,
        role,
        grants: role === 'EMPLOYEE' ? (opts.grants ?? []) : [],
        startDate:
          role === 'EMPLOYEE' ? toLocal(businessClock.now(), DEFAULT_COMPANY_TIME_ZONE).date : null,
        at: businessClock.now(),
      });
      if (opts.workspace === false) return { userId: user.id, workspaceId: '' };
      for (let attempt = 0; ; attempt += 1) {
        try {
          const ws = await container.workspace.provisioner.provisionDefault({
            ownerId: user.id,
            ownerFullName: fullName,
            attempt,
          });
          return { userId: user.id, workspaceId: ws.workspaceId };
        } catch (err) {
          if (!(err instanceof ResourceConflictError) || attempt > 3) throw err;
        }
      }
    });
    const { ip, token, cookie } = await login(email);
    return {
      ip,
      email,
      id: userId,
      token,
      workspaceId,
      cookie,
      auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip },
    };
  }

  /** Đăng nhập thật (`POST /auth/login`) từ một IP mới. */
  async function login(email: string, password = PASSWORD) {
    const ip = nextIp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });
    if (res.status !== 200)
      throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    const data = envelopeOf<{ accessToken: string }>(res).data;
    if (!data) throw new Error('login: thiếu data');
    const cookieName = overrides.cookieSecure ? '__Host-tf_rt' : 'tf_rt';
    return { ip, token: data.accessToken, cookie: refreshCookieOf(res, cookieName) };
  }

  return {
    app,
    container,
    persistence,
    companyStore,
    clock,
    businessClock,
    register,
    login,
    nextIp,
  };
}

export type TestApp = ReturnType<typeof createTestApp>;
export type TestUser = Awaited<ReturnType<TestApp['register']>>;

/** Giá trị `Set-Cookie` của refresh token (chuỗi đầy đủ để kiểm thuộc tính). */
export function setCookieOf(res: Response, name = 'tf_rt'): string | undefined {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith(`${name}=`));
}

/** Cặp `tf_rt=<token>` để gửi lại trong header Cookie. */
export function refreshCookieOf(res: Response, name = 'tf_rt'): string {
  const cookie = setCookieOf(res, name);
  if (!cookie) throw new Error('response không đặt cookie refresh');
  return cookie.split(';')[0] ?? '';
}
