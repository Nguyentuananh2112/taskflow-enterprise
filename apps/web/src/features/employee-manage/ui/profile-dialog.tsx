'use client';

import type { EmployeeProfileDto, PutEmployeeProfileResponse } from '@taskflow/contracts/company';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { companyKeys, profilesApi, useEmployeeProfile } from '@/entities/company';
import { isApiError } from '@/shared/api';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog } from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Skeleton } from '@/shared/ui/skeleton';
import { toast } from '@/shared/ui/toast';

import { dmy } from '../lib/messages';
import { profileChanges, profileErrorMessage, profileFormOf } from '../lib/profile-form';
import { ProfileFields } from './profile-fields';
import { SavedNotice } from './saved-notice';

type Props = Readonly<{ userId: string; fullName: string; today: string; onClose: () => void }>;

/**
 * "Sửa hồ sơ" (HR — ADR-128). Tải hồ sơ mới nhất mỗi lần mở; form dựng lại theo `version` ⇒ "Tải bản mới" sau 409
 * hiện bản của người kia. Đổi ngày vào ĐÃ CÓ ⇒ ô "Lý do sửa" bắt buộc.
 */
export function ProfileDialog({ userId, fullName, today, onClose }: Props) {
  const profile = useEmployeeProfile(userId);
  // Ở CẤP HỘP: lưu xong `version` đổi ⇒ form dựng lại, thông báo hệ quả không được mất theo.
  const [result, setResult] = useState<PutEmployeeProfileResponse | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Sửa hồ sơ — ${fullName}`}
      description="Thông tin công việc, không ghi dữ liệu cá nhân (CCCD, địa chỉ, ngày sinh)."
    >
      {result ? (
        <SavedNotice result={result} onClose={onClose} />
      ) : profile.data ? (
        <ProfileEditor
          key={profile.data.version}
          profile={profile.data}
          today={today}
          onClose={onClose}
          onSaved={setResult}
          onReload={() => void profile.refetch()}
        />
      ) : profile.isError ? (
        <Alert>{profileErrorMessage(profile.error)}</Alert>
      ) : (
        <div role="status" aria-busy="true" aria-label="Đang tải hồ sơ" className="grid gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
    </Dialog>
  );
}

type EditorProps = Readonly<{
  profile: EmployeeProfileDto;
  today: string;
  onClose: () => void;
  onSaved: (r: PutEmployeeProfileResponse) => void;
  onReload: () => void;
}>;

function ProfileEditor({ profile, today, onClose, onSaved, onReload }: EditorProps) {
  const before = profileFormOf(profile);
  const [state, setState] = useState({ form: before, reason: '' });
  const changes = profileChanges(state.form, before);
  const needsReason = before.hireDate !== '' && changes.hireDate !== undefined;
  const save = useMutation({
    mutationFn: () =>
      profilesApi.put(profile.userId, {
        ...changes,
        expectedVersion: profile.version,
        ...(needsReason ? { reason: state.reason.trim() } : {}),
      }),
    onSuccess: (r, _v, _c, context) => {
      void context.client.invalidateQueries({ queryKey: companyKeys.employees() });
      context.client.setQueryData(companyKeys.profile(profile.userId), r.profile);
      if (r.negativeBalances.length > 0 || r.warnings.length > 0) onSaved(r);
      else {
        toast({ title: `Đã lưu hồ sơ của ${profile.fullName}`, tone: 'success' });
        onClose();
      }
    },
  });
  const conflict = isApiError(save.error, 'VERSION_CONFLICT');
  return (
    <div className="flex flex-col gap-3">
      {save.isError && (
        <Alert>
          {profileErrorMessage(save.error)}
          {conflict && (
            <Button size="sm" variant="secondary" className="mt-2" onClick={onReload}>
              Tải bản mới
            </Button>
          )}
        </Alert>
      )}
      <ProfileFields
        value={state.form}
        onChange={(form) => setState((s) => ({ ...s, form }))}
        today={today}
      />
      {needsReason && (
        <Input
          label="Lý do sửa ngày vào công ty"
          required
          maxLength={500}
          value={state.reason}
          onChange={(e) => setState((s) => ({ ...s, reason: e.target.value }))}
          hint={`Đang là ${dmy(before.hireDate)}. Đổi ngày vào ảnh hưởng phụ cấp thâm niên và phép năm.`}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Hủy
        </Button>
        <Button
          loading={save.isPending}
          disabled={Object.keys(changes).length === 0 || (needsReason && !state.reason.trim())}
          onClick={() => save.mutate()}
        >
          Lưu
        </Button>
      </div>
    </div>
  );
}
