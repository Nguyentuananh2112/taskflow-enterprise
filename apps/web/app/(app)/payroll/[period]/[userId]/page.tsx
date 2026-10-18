import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Phiếu lương' };

export const dynamic = 'force-dynamic';

export { PayslipEditPage as default } from '@/views/payslip-edit';
