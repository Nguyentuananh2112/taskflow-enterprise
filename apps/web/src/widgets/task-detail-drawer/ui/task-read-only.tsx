import type { TaskDto } from '@taskflow/contracts/task';

import { DueDate, PriorityBadge, STATUS_LABEL } from '@/entities/task';

/** VIEWER / project lưu trữ: mọi trường ở dạng chỉ đọc — text, không phải input (wireframe §1.5). */
export function TaskReadOnly({ task }: Readonly<{ task: TaskDto }>) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold break-words">{task.title}</h3>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        <dt className="text-text-muted">Trạng thái</dt>
        <dd>{STATUS_LABEL[task.status]}</dd>
        <dt className="text-text-muted">Ưu tiên</dt>
        <dd>
          <PriorityBadge priority={task.priority} />
        </dd>
        <dt className="text-text-muted">Hạn chót</dt>
        <dd>
          {task.dueDate ? (
            <DueDate dueDate={task.dueDate} done={task.status === 'DONE'} />
          ) : (
            'Không có'
          )}
        </dd>
      </dl>
      <div>
        <h4 className="text-sm text-text-muted">Mô tả</h4>
        <p className="whitespace-pre-wrap break-words text-sm">
          {task.description ?? 'Chưa có mô tả.'}
        </p>
      </div>
    </div>
  );
}
