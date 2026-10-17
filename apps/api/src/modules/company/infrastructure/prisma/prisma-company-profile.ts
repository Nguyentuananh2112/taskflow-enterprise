import type { Prisma } from '../../../../generated/prisma/client';
import type {
  CompanyProfile,
  ICompanyRepository,
} from '../../application/ports/company-member.port';

/** = `uow.db()` (như `DbProvider` của prisma-company.ts — khai lại để không vòng import). */
type DbProvider = () => Prisma.TransactionClient;

/** Id cố định của dòng công ty duy nhất (CHECK `companies_single_row`). */
export const COMPANY_ID = 1;

export class PrismaCompany implements ICompanyRepository {
  constructor(private readonly db: DbProvider) {}

  get(): Promise<CompanyProfile | null> {
    return this.db().company.findUnique({
      where: { id: COMPANY_ID },
      select: { name: true, version: true },
    });
  }

  async ensure(name: string, at: Date): Promise<CompanyProfile> {
    // ON CONFLICT DO NOTHING: hai bootstrap đồng thời đã tuần tự hóa bằng khóa `company:admins`, vẫn an toàn.
    await this.db().$executeRaw`
      INSERT INTO companies (id, name, version, updated_at) VALUES (${COMPANY_ID}, ${name}, 1, ${at})
      ON CONFLICT (id) DO NOTHING`;
    const row = await this.get();
    if (!row) throw new Error('companies: không đọc lại được dòng vừa tạo');
    return row;
  }

  async rename(input: {
    name: string;
    expectedVersion: number;
    at: Date;
  }): Promise<CompanyProfile | null> {
    const { count } = await this.db().company.updateMany({
      where: { id: COMPANY_ID, version: input.expectedVersion },
      data: { name: input.name, version: { increment: 1 }, updatedAt: input.at },
    });
    return count === 1 ? this.get() : null;
  }
}
