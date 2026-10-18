'use client';

import type { ChatPersonDto } from '@taskflow/contracts/chat';
import { useState } from 'react';

import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Combobox } from '@/shared/ui/combobox';

import { useChatPeople } from '../model/use-chat';

type Props = Readonly<{
  label?: string;
  /** Không hiện (vd chính mình, người đã chọn / đã trong nhóm). */
  exclude?: ReadonlySet<string>;
  onPick: (person: ChatPersonDto) => void;
  disabled?: boolean;
}>;

/**
 * Tìm người trong công ty để nhắn (`GET chat/people?q` — R49: không email, không người chờ kích hoạt / đã rời). Gõ ≥ 1 ký
 * tự; mỗi lần chọn một người.
 */
export function PeoplePicker({ label = 'Tìm người', exclude, onPick, disabled }: Props) {
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim(), 250);
  const people = useChatPeople(term);
  const shown = (people.data ?? []).filter((p) => !exclude?.has(p.id));
  return (
    <Combobox
      label={label}
      query={query}
      onQueryChange={setQuery}
      selectedLabel=""
      options={shown.map((p) => ({ value: p.id, label: p.fullName }))}
      onSelect={(id) => {
        const person = shown.find((p) => p.id === id);
        if (person) onPick(person);
      }}
      loading={people.isFetching}
      emptyText={term ? 'Không tìm thấy ai' : 'Gõ tên để tìm'}
      {...(disabled ? { disabled } : {})}
    />
  );
}
