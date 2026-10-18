import type { PayrollTodoDto } from '@taskflow/contracts/payroll';
import Link from 'next/link';

import { todoText } from '@/entities/payroll';

const HR_FIX = new Set<PayrollTodoDto['kind']>(['MISSING_HIRE_DATE', 'HIRE_DATE_AFTER_PERIOD']);

/**
 * Việc còn lại (§5.2): mỗi việc một dòng chữ; ngày vào công ty do HR sửa ⇒ link tới danh sách nhân viên nếu người xem
 * có `hr:manage`, không thì "Báo HR bổ sung".
 */
export function TodoList({
  todo,
  canHr,
}: Readonly<{ todo: readonly PayrollTodoDto[]; canHr: boolean }>) {
  return (
    <section
      aria-labelledby="payroll-todo"
      className="rounded-card border border-warning bg-surface p-4"
    >
      <h2 id="payroll-todo" className="text-base font-semibold">
        Việc còn lại
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {todo.map((t, i) => (
          <li key={`${t.kind}-${t.user?.id ?? ''}-${t.date ?? ''}-${i}`}>
            {todoText(t)}
            {HR_FIX.has(t.kind) &&
              (canHr ? (
                <>
                  {' — '}
                  <Link href="/hr/employees" className="underline">
                    sửa ở Nhân viên
                  </Link>
                </>
              ) : (
                ' — báo HR bổ sung'
              ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
