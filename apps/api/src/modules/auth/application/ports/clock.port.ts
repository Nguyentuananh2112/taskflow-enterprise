// TODO(T-009): thay bằng IClock của core kernel khi T-009 merge (ticket T-013 cho phép định nghĩa tạm).
export interface IClock {
  now(): Date;
}
