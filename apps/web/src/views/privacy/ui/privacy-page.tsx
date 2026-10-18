'use client';

import { PrivacyNotice, usePrivacy } from '@/entities/privacy';
import { useAckPrivacy } from '@/features/privacy-ack';
import { LeaveReasonConsent } from '@/features/privacy-consent';
import { serverErrorMessage } from '@/shared/lib/form-errors';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { PageMain } from '@/shared/ui/page';
import { Skeleton } from '@/shared/ui/skeleton';

const dmy = (iso: string) =>
  new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date(iso));

/**
 * `/privacy` (T-075): mọi người đã đăng nhập luôn xem lại được thông báo xử lý dữ liệu cá nhân (data-retention.md §5),
 * xác nhận đã đọc phiên bản hiện hành, và bật / tắt đồng ý cho lý do nghỉ.
 */
export function PrivacyPage() {
  const q = usePrivacy();
  const { ack, outdated } = useAckPrivacy();
  const p = q.data;
  return (
    <PageMain className="max-w-3xl gap-5">
      <h1 className="text-xl font-semibold">Quyền riêng tư</h1>
      {q.isError ? (
        <EmptyState
          title="Không tải được thông báo quyền riêng tư"
          action={<Button onClick={() => void q.refetch()}>Thử lại</Button>}
        />
      ) : !p ? (
        <div role="status" aria-busy="true" aria-label="Đang tải" className="grid gap-2">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {p.needsAck ? (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
              <p className="text-sm">
                {p.ackVersion === null
                  ? 'Bạn chưa xác nhận đã đọc thông báo này.'
                  : 'Thông báo đã được cập nhật kể từ lần bạn xác nhận — hãy đọc lại.'}
              </p>
              {ack.isError && (
                <Alert>
                  {outdated
                    ? 'Thông báo vừa được cập nhật — đã tải nội dung mới, hãy đọc lại.'
                    : serverErrorMessage(ack.error)}
                </Alert>
              )}
              <Button
                className="self-start"
                loading={ack.isPending}
                onClick={() => ack.mutate(p.version)}
              >
                Tôi đã đọc
              </Button>
            </div>
          ) : (
            p.ackedAt && (
              <p className="text-sm text-text-muted">Bạn đã xác nhận đọc ngày {dmy(p.ackedAt)}.</p>
            )
          )}
          <PrivacyNotice companyName={p.companyName} contact={p.privacyContact} />
          <section aria-labelledby="privacy-consent" className="flex flex-col gap-2">
            <h2 id="privacy-consent" className="text-base font-semibold">
              Đồng ý của bạn
            </h2>
            <LeaveReasonConsent privacy={p} />
          </section>
        </>
      )}
    </PageMain>
  );
}
