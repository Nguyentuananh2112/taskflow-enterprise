import { readFileSync } from 'node:fs';

import { TaskAuditAction, TaskPriority, TaskStatus, WorkspaceRole } from '@taskflow/contracts';
import { describe, expect, it } from 'vitest';

/**
 * data-and-api §5.2: contracts không import Prisma enum ⇒ test này giữ hai bên khớp (cả thứ tự —
 * Postgres sắp enum theo thứ tự khai báo, `GET tasks` sắp theo `status`). Đọc thẳng
 * schema.prisma nên không cần `prisma generate` hay DB.
 */
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

function prismaEnum(name: string): string[] {
  const body = new RegExp(`^enum ${name} [{]([^}]*)[}]`, 'm').exec(schema)?.[1];
  if (body === undefined) throw new Error(`Không thấy enum ${name} trong schema.prisma`);
  return body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

describe('Prisma enum ↔ @taskflow/contracts', () => {
  it.each([
    ['WorkspaceRole', WorkspaceRole.options],
    ['TaskStatus', TaskStatus.options],
    ['TaskPriority', TaskPriority.options],
    ['TaskAuditAction', TaskAuditAction.options],
  ] as const)('%s khớp cả giá trị lẫn thứ tự', (name, options) => {
    expect(prismaEnum(name)).toEqual([...options]);
  });
});
