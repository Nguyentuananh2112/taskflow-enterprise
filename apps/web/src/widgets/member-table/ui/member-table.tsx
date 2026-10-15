'use client';

import { useState } from 'react';

import { useMembers } from '@/entities/member';
import type { PermissionApi } from '@/entities/workspace';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';

import { MemberRow } from './member-row';

type Props = Readonly<{ wsId: string; permission: PermissionApi; onLeft: () => void }>;

/** Bảng thành viên (wireframe §1.6): tìm `q` phía server (debounce 300ms), phân trang cursor. */
export function MemberTable({ wsId, permission, onLeft }: Props) {
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const members = useMembers(wsId, q);
  const rows = members.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <section aria-labelledby="member-list" className="flex flex-col gap-3">
      <h2 id="member-list" className="text-base font-semibold">
        Danh sách thành viên
      </h2>
      <Input
        label="Tìm theo tên hoặc email"
        type="search"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {members.isPending && (
        <div role="status" aria-busy="true" aria-label="Đang tải thành viên" className="grid gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      )}
      {members.isError && (
        <EmptyState
          title="Không tải được danh sách thành viên"
          action={<Button onClick={() => void members.refetch()}>Thử lại</Button>}
        />
      )}
      {members.isSuccess && rows.length === 0 && (
        <p className="text-sm text-text-muted">Không có thành viên khớp.</p>
      )}
      {rows.length > 0 && (
        // Màn hẹp: email dài + ô vai trò ⇒ cuộn ngang TRONG bảng, không đẩy cả trang (E3).
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Thành viên
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Vai trò
                </th>
                <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                  Tham gia
                </th>
                <th scope="col" className="py-2 font-medium">
                  <span className="sr-only">Thao tác</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <MemberRow
                  key={member.userId}
                  wsId={wsId}
                  member={member}
                  permission={permission}
                  onLeft={onLeft}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {members.hasNextPage && (
        <Button
          variant="secondary"
          className="self-center"
          loading={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          Tải thêm
        </Button>
      )}
    </section>
  );
}
