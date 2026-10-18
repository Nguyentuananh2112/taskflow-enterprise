'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { CreateProjectForm } from '@/features/project-create';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';

type Props = Readonly<{ wsId: string; canCreate: boolean }>;

/** Tiêu đề + "Tạo dự án" (PM+, ẩn với role khác — frontend.md §1.3) + lối vào cài đặt/thành viên. */
export function ProjectListHeader({ wsId, canCreate }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-semibold">Dự án</h1>
      <nav aria-label="Workspace" className="ml-auto flex items-center gap-2 text-sm">
        {/* Mốc 6 (ADR-143): phòng trò chuyện của workspace — mọi role kể cả VIEWER. */}
        <Link href={`/chat/ws/${wsId}`} className="rounded-control px-3 py-1.5 hover:bg-bg-subtle">
          Trò chuyện
        </Link>
        <Link
          href={`/w/${wsId}/settings/members`}
          className="rounded-control px-3 py-1.5 hover:bg-bg-subtle"
        >
          Thành viên
        </Link>
        <Link
          href={`/w/${wsId}/settings`}
          className="rounded-control px-3 py-1.5 hover:bg-bg-subtle"
        >
          Cài đặt
        </Link>
      </nav>
      {canCreate && (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          trigger={<Button>Tạo dự án</Button>}
          title="Tạo dự án"
        >
          <CreateProjectForm
            wsId={wsId}
            onCreated={(project) => {
              setOpen(false);
              router.push(`/w/${wsId}/p/${project.id}`);
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
