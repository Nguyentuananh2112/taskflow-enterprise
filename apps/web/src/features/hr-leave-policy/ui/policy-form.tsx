'use client';

import {
  LeavePolicyFields,
  type LeavePolicyDto,
  type PutLeavePolicyResponse,
} from '@taskflow/contracts/leave';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { hrKeys, hrLeaveApi } from '@/entities/hr';
import { daysText } from '@/entities/leave';
import { isApiError } from '@/shared/api';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

import { policyExample } from '../lib/policy-example';
import { PolicyFields, type PolicyFormState } from './policy-fields';

type Props = Readonly<{ policy: LeavePolicyDto; onReload: () => void; onClose: () => void }>;

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')));

/** Một năm chính sách: số liệu là chuỗi trong ô nhập, kiểm bằng CHÍNH schema contracts trước khi cho lưu. */
export function PolicyForm({ policy, onReload, onClose }: Props) {
  const [f, setF] = useState<PolicyFormState>({
    annualDays: String(policy.annualDays),
    seniorityStepYears: String(policy.seniorityStepYears),
    seniorityBonusDays: String(policy.seniorityBonusDays),
    carryOverEnabled: policy.carryOverEnabled,
    carryOverMaxDays: String(policy.carryOverMaxDays),
    carryOverExpiryMonth: String(policy.carryOverExpiryMonth),
  });
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<PutLeavePolicyResponse | null>(null);
  const parsed = LeavePolicyFields.safeParse({
    ...f,
    annualDays: num(f.annualDays),
    seniorityStepYears: num(f.seniorityStepYears),
    seniorityBonusDays: num(f.seniorityBonusDays),
    carryOverMaxDays: f.carryOverEnabled ? num(f.carryOverMaxDays) : 0,
    carryOverExpiryMonth: num(f.carryOverExpiryMonth),
  });
  const save = useMutation({
    mutationFn: () =>
      hrLeaveApi.putPolicy(policy.year, {
        ...(parsed.data ?? policy),
        expectedVersion: policy.version,
      }),
    onSuccess: (r, _v, _c, context) => {
      context.client.setQueryData(hrKeys.policy(policy.year), r.policy);
      void context.client.invalidateQueries({ queryKey: hrKeys.balances(policy.year) });
      toast({ title: `Đã lưu chính sách phép năm ${policy.year}`, tone: 'success' });
      if (r.negativeBalances.length > 0) setResult(r);
      else onClose();
    },
    onSettled: () => setConfirming(false),
  });

  if (result)
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="info">
          Theo chính sách mới, số phép còn lại bị âm:{' '}
          {result.negativeBalances
            .map((b) => `${b.user.fullName} (${daysText(b.remainingDays)})`)
            .join(', ')}
          . Đơn đã duyệt không bị thu hồi — kiểm tra ở bảng Số phép.
        </Alert>
        <Button className="self-end" onClick={onClose}>
          Đóng
        </Button>
      </div>
    );
  if (!policy.editable) return <Alert tone="info">Năm {policy.year} đã qua — chỉ xem.</Alert>;
  return (
    <div className="flex flex-col gap-3">
      {policy.source !== 'SET' && (
        <p className="text-sm text-text-muted">
          {policy.source === 'INHERITED'
            ? `Năm ${policy.year} chưa đặt riêng — đang dùng chính sách năm ${policy.inheritedFromYear ?? ''}.`
            : `Năm ${policy.year} chưa đặt — đang dùng mức luật.`}
        </p>
      )}
      {save.isError && (
        <Alert>
          {isApiError(save.error, 'VERSION_CONFLICT')
            ? 'Chính sách vừa được người khác sửa.'
            : serverErrorMessage(save.error)}
          {isApiError(save.error, 'VERSION_CONFLICT') && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={onReload}>
              Tải bản mới
            </Button>
          )}
        </Alert>
      )}
      <PolicyFields value={f} onChange={setF} />
      {parsed.success ? (
        <p className="text-sm text-text-muted">{policyExample(parsed.data, policy.year)}</p>
      ) : (
        <Alert>Có ô chưa hợp lệ — xem gợi ý dưới từng ô (bước 0,5 ngày).</Alert>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {confirming && <span className="text-sm">Lưu cho cả công ty, năm {policy.year}?</span>}
        <Button variant="secondary" onClick={() => (confirming ? setConfirming(false) : onClose())}>
          {confirming ? 'Thôi' : 'Hủy'}
        </Button>
        <Button
          loading={save.isPending}
          disabled={!parsed.success}
          onClick={() => (confirming ? save.mutate() : setConfirming(true))}
        >
          {confirming ? 'Xác nhận lưu' : 'Lưu'}
        </Button>
      </div>
    </div>
  );
}
