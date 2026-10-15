import Link from 'next/link';

import { cn } from '@/shared/lib/cn';

type Props = Readonly<{ wsId: string; current: 'general' | 'members' }>;

/** "Cài đặt workspace › [Chung] [Thành viên]" (wireframe §1.6) — link thật, Back hoạt động. */
export function SettingsTabs({ wsId, current }: Props) {
  const tabs = [
    { key: 'general', label: 'Chung', href: `/w/${wsId}/settings` },
    { key: 'members', label: 'Thành viên', href: `/w/${wsId}/settings/members` },
  ] as const;
  return (
    <nav aria-label="Cài đặt workspace" className="flex gap-2 border-b border-border">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 px-3 py-2 text-sm',
            tab.key === current
              ? 'border-primary font-medium'
              : 'border-transparent hover:text-primary',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
