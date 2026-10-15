import type { IDomainEvent } from '../domain';
import type { ILogger } from '../logging/logger';

export type EventHandler<E extends IDomainEvent = IDomainEvent> = (
  event: E,
) => void | Promise<void>;
export type Unsubscribe = () => void;

/** Bus sự kiện miền. Publish **sau commit** (ADR-012) — gọi từ `uow.afterCommit(...)`. */
export interface IEventBus {
  publish(events: readonly IDomainEvent[]): Promise<void>;
  subscribe<E extends IDomainEvent>(type: E['type'], handler: EventHandler<E>): Unsubscribe;
}

/**
 * Bus trong tiến trình: handler chạy tuần tự theo thứ tự đăng ký. Lỗi của một handler
 * được **log** (kèm loại event, handler) rồi chạy tiếp các handler khác — không nuốt im lặng,
 * và không làm hỏng request đã commit.
 */
export class InProcessEventBus implements IEventBus {
  readonly #handlers = new Map<string, EventHandler[]>();

  constructor(private readonly logger: ILogger) {}

  subscribe<E extends IDomainEvent>(type: E['type'], handler: EventHandler<E>): Unsubscribe {
    const list = this.#handlers.get(type) ?? [];
    list.push(handler as EventHandler);
    this.#handlers.set(type, list);
    return () => {
      const current = this.#handlers.get(type) ?? [];
      this.#handlers.set(
        type,
        current.filter((h) => h !== handler),
      );
    };
  }

  async publish(events: readonly IDomainEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of [...(this.#handlers.get(event.type) ?? [])]) {
        try {
          await handler(event);
        } catch (err) {
          this.logger.error(
            {
              err,
              eventType: event.type,
              aggregateId: event.aggregateId,
              handler: handler.name || 'anonymous',
            },
            'event.handler_failed',
          );
        }
      }
    }
  }
}
