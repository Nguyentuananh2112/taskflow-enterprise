import { MeResponse } from '@taskflow/contracts/auth';
import { AdminWorkspaceDto, MeCompanyDto } from '@taskflow/contracts/company';
import { Uuid } from '@taskflow/contracts/common';
import * as z from 'zod';

// TẠM (T-065a): `/auth/me` có khối `company` (ADR-135) — contracts 1bb5f42 của B đã có `MeCompanyDto` nhưng `MeResponse`
// chỉ thêm `company` ở commit code T-061. Khi đó xóa file này, dùng `MeResponse` của contracts.
export const MeWithCompanyResponse = MeResponse.extend({ company: MeCompanyDto });
export type MeWithCompanyResponse = z.infer<typeof MeWithCompanyResponse>;

// TẠM (T-065b, TL chốt): workspace mồ côi kèm thành viên CÒN LẠI (chỉ tên — không dữ liệu dự án) để Admin giao OWNER.
// B thêm vào `AdminWorkspaceDto` của contracts ⇒ xóa phần này, dùng contracts.
export const AdminWorkspaceWithMembersDto = AdminWorkspaceDto.extend({
  members: z.array(z.object({ userId: Uuid, fullName: z.string() })).optional(),
});
export type AdminWorkspaceWithMembersDto = z.infer<typeof AdminWorkspaceWithMembersDto>;
