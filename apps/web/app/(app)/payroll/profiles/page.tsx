import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Hồ sơ lương' };

export const dynamic = 'force-dynamic';

export { PayrollProfilesPage as default } from '@/views/payroll-profiles';
