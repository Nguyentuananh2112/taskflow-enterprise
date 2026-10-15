'use client';

import type { TaskDto } from '@taskflow/contracts/task';
import { useState } from 'react';

import { useAssignableMembers } from '@/entities/member';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Combobox } from '@/shared/ui/combobox';

const UNASSIGNED = '';

type Props = Readonly<{
  wsId: string;
  task: TaskDto;
  disabled: boolean;
  hint?: string | undefined;
  onSelect: (assigneeId: string | null) => void;
}>;

/**
 * Chọn người phụ trách có tìm kiếm (`q` phía server, debounce 300ms — ADR-083). Chỉ liệt kê role
 * ≥ MEMBER (ADR-044); server vẫn chặn `ASSIGNEE_NOT_MEMBER`.
 */
export function AssigneePicker({ wsId, task, disabled, hint, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 300);
  const members = useAssignableMembers(wsId, q, !disabled);
  const options = [
    ...(q === '' ? [{ value: UNASSIGNED, label: 'Chưa giao' }] : []),
    ...(members.data ?? []).map((m) => ({
      value: m.userId,
      label: m.fullName,
      description: m.email,
    })),
  ];
  return (
    <Combobox
      label="Người phụ trách"
      options={options}
      selectedLabel={task.assignee?.fullName ?? 'Chưa giao'}
      query={query}
      onQueryChange={setQuery}
      onSelect={(value) => {
        const next = value === UNASSIGNED ? null : value;
        if (next !== (task.assignee?.id ?? null)) onSelect(next);
      }}
      loading={members.isFetching}
      disabled={disabled}
      hint={hint}
      emptyText="Không tìm thấy thành viên có thể giao việc"
    />
  );
}
