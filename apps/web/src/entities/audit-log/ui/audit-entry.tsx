import type { AuditLogDto } from '@taskflow/contracts/audit';

import { describeAudit, relativeTime } from '../model/describe';

/** Một dòng lịch sử: "Trần Lan đổi trạng thái Cần làm → Đang làm · 2 phút trước". */
export function AuditEntry({ entry }: Readonly<{ entry: AuditLogDto }>) {
  return (
    <li className="flex flex-col text-sm">
      <span>
        <span className="font-medium">{entry.actor.fullName}</span> {describeAudit(entry)}
      </span>
      <time dateTime={entry.createdAt} className="text-xs text-text-muted">
        {relativeTime(entry.createdAt)}
      </time>
    </li>
  );
}
