import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Phiếu lương' };

export const dynamic = 'force-dynamic';

export { MyPayslipsPage as default } from '@/views/my-payslips';
