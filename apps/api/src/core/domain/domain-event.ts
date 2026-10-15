/** Sự kiện miền (ADR-013). Chỉ chứa dữ liệu thuần — không tham chiếu entity, không I/O. */
export interface IDomainEvent {
  /** Tên sự kiện dạng PascalCase, vd `TaskCreated`. */
  readonly type: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
}
