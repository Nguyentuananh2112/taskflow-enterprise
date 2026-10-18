import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bảng lương' };

export const dynamic = 'force-dynamic';

export { PayrollRunsPage as default } from '@/views/payroll-runs';
