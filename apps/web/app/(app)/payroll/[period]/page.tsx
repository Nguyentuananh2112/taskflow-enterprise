import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Bảng lương tháng' };

export const dynamic = 'force-dynamic';

export { PayrollRunPage as default } from '@/views/payroll-run';
