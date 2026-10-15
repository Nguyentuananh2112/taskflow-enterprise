import type { IDomainEvent } from './domain-event';

/** Entity: định danh bằng `id`, hai entity cùng loại và cùng id là một. */
export abstract class Entity<TId extends string = string> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId> | null | undefined): boolean {
    if (!other) return false;
    if (other === this) return true;
    return other.constructor === this.constructor && other.id === this.id;
  }
}

/**
 * Aggregate root: gom domain event phát sinh trong một lần thay đổi.
 * Application lấy ra bằng `pullDomainEvents()` rồi publish **sau commit** (ADR-012).
 */
export abstract class AggregateRoot<
  TEvent extends IDomainEvent = IDomainEvent,
  TId extends string = string,
> extends Entity<TId> {
  #pendingEvents: TEvent[] = [];

  protected addDomainEvent(event: TEvent): void {
    this.#pendingEvents.push(event);
  }

  /** Trả các event đang chờ theo thứ tự phát sinh và xóa danh sách (gọi lần 2 ⇒ mảng rỗng). */
  pullDomainEvents(): TEvent[] {
    const events = this.#pendingEvents;
    this.#pendingEvents = [];
    return events;
  }

  get hasPendingDomainEvents(): boolean {
    return this.#pendingEvents.length > 0;
  }
}
