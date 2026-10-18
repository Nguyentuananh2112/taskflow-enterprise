import { periodLastDay } from '@taskflow/contracts/payroll';

/** Mọi ngày của kỳ YYYY-MM; T2–T7 là ngày làm (lịch mặc định của mock). */
export const daysOf = (period: string) => {
  const last = Number(periodLastDay(period).slice(8));
  return Array.from({ length: last }, (_, i) => `${period}-${String(i + 1).padStart(2, '0')}`);
};
export const workday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0;
