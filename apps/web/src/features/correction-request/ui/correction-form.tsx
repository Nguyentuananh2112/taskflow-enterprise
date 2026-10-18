'use client';

import { CORRECTION_NEXT_DAY_BEFORE } from '@taskflow/contracts/attendance';
import type { AttendanceKind } from '@taskflow/contracts/hr';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { correctionApi, correctionErrorMessage, correctionKeys } from '@/entities/correction';
import { isApiError } from '@/shared/api';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { toast } from '@/shared/ui/toast';

type Props = Readonly<{ date: string; kind: AttendanceKind; onDone: () => void }>;

/**
 * Form xin bổ sung giờ (ADR-129) — nằm NGAY trong hộp chi tiết ngày (không mở hộp thứ hai): ngày + loại cố định, giờ,
 * "Ra sau nửa đêm" khi giờ ra < 06:00, lý do. MỘT `Idempotency-Key` cho mỗi lần mở form: bấm lại / thử lại sau lỗi
 * mạng không thành 2 đơn.
 */
export function CorrectionForm({ date, kind, onDone }: Props) {
  const [key] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ time: '', nextDay: false, reason: '' });
  const canNextDay = kind === 'OUT' && form.time !== '' && form.time < CORRECTION_NEXT_DAY_BEFORE;
  const submit = useMutation({
    mutationFn: () =>
      correctionApi.submit(
        {
          date,
          kind,
          time: form.time,
          nextDay: canNextDay && form.nextDay,
          reason: form.reason.trim(),
        },
        key,
      ),
    onSuccess: (_r, _v, _c, context) => {
      void context.client.invalidateQueries({ queryKey: correctionKeys.mine() });
      toast({ title: 'Đã gửi đơn — chờ bộ phận nhân sự duyệt', tone: 'success' });
      onDone();
    },
    onError: (error, _v, _c, context) => {
      // Đã có đơn chờ (vd gửi ở tab khác) ⇒ tải lại để nút đổi thành "Đã gửi đơn".
      if (isApiError(error, 'RESOURCE_CONFLICT'))
        void context.client.invalidateQueries({ queryKey: correctionKeys.mine() });
    },
  });
  return (
    <form
      aria-label={kind === 'IN' ? 'Xin bổ sung giờ vào' : 'Xin bổ sung giờ ra'}
      className="flex flex-col gap-3 rounded-card border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate();
      }}
    >
      {submit.isError && <Alert>{correctionErrorMessage(submit.error)}</Alert>}
      <Input
        label={kind === 'IN' ? 'Giờ vào' : 'Giờ ra'}
        type="time"
        required
        value={form.time}
        onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
      />
      {canNextDay && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.nextDay}
            onChange={(e) => setForm((f) => ({ ...f, nextDay: e.target.checked }))}
          />
          Ra sau nửa đêm (sáng hôm sau)
        </label>
      )}
      <Textarea
        label="Lý do"
        required
        rows={2}
        maxLength={500}
        value={form.reason}
        onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
        hint="Ví dụ: Quên bấm Ra khi về. Không cần ghi bệnh hay chuyện riêng."
      />
      <p className="text-xs text-text-muted">Gửi trước ngày 5 để kịp tính lương tháng.</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Thôi
        </Button>
        <Button
          type="submit"
          loading={submit.isPending}
          disabled={!form.time || !form.reason.trim()}
        >
          Gửi đơn
        </Button>
      </div>
    </form>
  );
}
