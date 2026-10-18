import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Phiếu lương' };

// Mở thẳng phiếu mới nhất (payroll.md §5.1). Trang có số tiền ⇒ không cache tĩnh.
export const dynamic = 'force-dynamic';

export { MyPayslipsPage as default } from '@/views/my-payslips';
