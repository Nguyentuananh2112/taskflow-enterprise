import type { IDomainEvent } from '../../src/core/domain';
import type { EventHandler, IEventBus, Unsubscribe } from '../../src/core/events/event-bus';
import type { ILogger } from '../../src/core/logging/logger';

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  msg: string | undefined;
  data: Record<string, unknown>;
}

/** Logger ghi lại mọi dòng; `child()` dùng chung danh sách, gộp bindings vào `data`. */
export class SpyLogger implements ILogger {
  constructor(
    readonly entries: LogEntry[] = [],
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  debug = this.#log('debug');
  info = this.#log('info');
  warn = this.#log('warn');
  error = this.#log('error');
  fatal = this.#log('fatal');

  child(bindings: Record<string, unknown>): ILogger {
    return new SpyLogger(this.entries, { ...this.bindings, ...bindings });
  }

  messages(level?: LogEntry['level']): (string | undefined)[] {
    return this.entries.filter((e) => !level || e.level === level).map((e) => e.msg);
  }

  #log(level: LogEntry['level']) {
    return (objOrMsg: object | string, msg?: string): void => {
      const isMsg = typeof objOrMsg === 'string';
      this.entries.push({
        level,
        msg: isMsg ? objOrMsg : msg,
        data: { ...this.bindings, ...(isMsg ? {} : (objOrMsg as Record<string, unknown>)) },
      });
    };
  }
}

/** Ghi lại event đã publish; handler đăng ký vẫn được gọi (đủ cho test A). */
export class SpyEventBus implements IEventBus {
  readonly published: IDomainEvent[] = [];
  readonly #handlers = new Map<string, EventHandler[]>();

  publish(events: readonly IDomainEvent[]): Promise<void> {
    this.published.push(...events);
    return events.reduce(
      (chain, event) =>
        chain.then(async () => {
          for (const handler of this.#handlers.get(event.type) ?? []) await handler(event);
        }),
      Promise.resolve(),
    );
  }

  subscribe<E extends IDomainEvent>(type: E['type'], handler: EventHandler<E>): Unsubscribe {
    this.#handlers.set(type, [...(this.#handlers.get(type) ?? []), handler as EventHandler]);
    return () =>
      this.#handlers.set(
        type,
        (this.#handlers.get(type) ?? []).filter((h) => h !== handler),
      );
  }

  types(): string[] {
    return this.published.map((e) => e.type);
  }
}

export interface SpyCall {
  method: string;
  args: unknown[];
  /** `true` nếu gọi khi transaction còn mở — vi phạm ADR-012 cho realtime. */
  duringTransaction: boolean;
}

/**
 * Spy cho bất kỳ port nào (vd `IRealtimeNotifier` của Phase 2): mọi method đều tồn tại và
 * được ghi lại. Truyền `uow` để biết lời gọi xảy ra trong hay sau transaction.
 */
export function createSpy<T extends object>(uow?: {
  readonly inTransaction: boolean;
}): T & { readonly calls: SpyCall[] } {
  const calls: SpyCall[] = [];
  return new Proxy({ calls } as T & { calls: SpyCall[] }, {
    get(target, prop, receiver) {
      if (prop === 'calls' || typeof prop === 'symbol' || prop === 'then') {
        return Reflect.get(target, prop, receiver) as unknown;
      }
      return (...args: unknown[]) => {
        calls.push({ method: prop, args, duringTransaction: uow?.inTransaction ?? false });
        return Promise.resolve();
      };
    },
  });
}

/** Tên theo test-spec §0.2. */
export const createSpyRealtimeNotifier = createSpy;
