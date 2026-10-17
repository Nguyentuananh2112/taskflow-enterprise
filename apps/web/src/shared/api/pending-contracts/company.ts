import { MeResponse } from '@taskflow/contracts/auth';
import { MeCompanyDto } from '@taskflow/contracts/company';
import type * as z from 'zod';

// TẠM (T-065a): `/auth/me` có khối `company` (ADR-135) — contracts 1bb5f42 của B đã có `MeCompanyDto` nhưng `MeResponse`
// chỉ thêm `company` ở commit code T-061. Khi đó xóa file này, dùng `MeResponse` của contracts.
export const MeWithCompanyResponse = MeResponse.extend({ company: MeCompanyDto });
export type MeWithCompanyResponse = z.infer<typeof MeWithCompanyResponse>;
