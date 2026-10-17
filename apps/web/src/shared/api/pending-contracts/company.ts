import { AdminWorkspaceDto } from '@taskflow/contracts/company';
import { Uuid } from '@taskflow/contracts/common';
import * as z from 'zod';

// TẠM (T-065b, TL chốt): workspace mồ côi kèm thành viên CÒN LẠI (chỉ tên — không dữ liệu dự án) để Admin giao OWNER.
// B thêm vào `AdminWorkspaceDto` của contracts ⇒ xóa phần này, dùng contracts.
export const AdminWorkspaceWithMembersDto = AdminWorkspaceDto.extend({
  members: z.array(z.object({ userId: Uuid, fullName: z.string() })).optional(),
});
export type AdminWorkspaceWithMembersDto = z.infer<typeof AdminWorkspaceWithMembersDto>;
