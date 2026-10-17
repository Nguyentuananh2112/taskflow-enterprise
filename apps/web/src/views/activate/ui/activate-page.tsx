'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { callName } from '@/entities/attendance';
import { authApi, session, useSession } from '@/entities/session';
import {
  ActivateForm,
  forgetActivationToken,
  useActivationToken,
} from '@/features/account-activate';
import { LogoutButton } from '@/features/auth-logout';
import { isApiError } from '@/shared/api';
import { AuthCard } from '@/shared/ui/auth-card';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';

const GONE = 'Link không còn hiệu lực — xin bộ phận nhân sự link mới.';

/**
 * `/activate#t=…` — đặt mật khẩu lần đầu (ADR-137, E B1–B7). NGOÀI GuestGate / AuthGate: gate sẽ chuyển người đang
 * đăng nhập về /w và nuốt mất link (máy dùng chung). Mở trang KHÔNG tiêu token: chỉ đọc fragment ⇒ xóa khỏi URL ⇒
 * `inspect` (chỉ đọc); token chỉ bị tiêu khi bấm "Kích hoạt". Mọi câu là lời thường, không mã lỗi.
 */
export function ActivatePage() {
  if (typeof window !== 'undefined') session.prestart();
  const { status, user } = useSession();
  const token = useActivationToken();
  const router = useRouter();
  const [gone, setGone] = useState(false);
  useEffect(() => {
    void session.bootstrap();
  }, []);
  const inspect = useQuery({
    queryKey: ['activation', token],
    queryFn: () => authApi.inspectActivation(token ?? ''),
    enabled: typeof token === 'string' && status === 'anonymous' && !gone,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0, // token không nằm lại trong cache sau khi rời trang
  });

  const card = (title: string, body: ReactNode) => (
    <AuthCard title={title}>
      <div className="flex flex-col gap-4 text-sm">{body}</div>
    </AuthCard>
  );

  if (token === undefined || status === 'idle' || status === 'bootstrapping') {
    return card('Kích hoạt tài khoản', <Spinner label="Đang mở link…" />);
  }
  if (token === null) {
    return card(
      'Kích hoạt tài khoản',
      <p>Hãy mở lại link trong tin nhắn bộ phận nhân sự gửi cho bạn.</p>,
    );
  }
  if (status === 'authenticated') {
    return card(
      'Kích hoạt tài khoản',
      <>
        <p>
          Bạn đang đăng nhập là <strong>{user?.fullName}</strong>. Đăng xuất để kích hoạt tài khoản
          mới trên máy này.
        </p>
        <div>
          <LogoutButton />
        </div>
      </>,
    );
  }
  if (status === 'unreachable') {
    return card(
      'Không kết nối được',
      <Button onClick={() => void session.bootstrap()}>Thử lại</Button>,
    );
  }
  const e = inspect.error;
  if (gone || isApiError(e, 'ACTIVATION_INVALID') || isApiError(e, 'ACTIVATION_GONE')) {
    return card('Link không còn hiệu lực', <p>{GONE}</p>);
  }
  if (isApiError(e, 'RATE_LIMITED')) {
    return card('Thử lại sau', <p>Bạn đã thử quá nhiều lần. Hãy thử lại sau 15 phút.</p>);
  }
  if (inspect.isError) {
    return card(
      'Không mở được link',
      <Button onClick={() => void inspect.refetch()}>Thử lại</Button>,
    );
  }
  const account = inspect.data;
  if (!account) return card('Kích hoạt tài khoản', <Spinner label="Đang mở link…" />);
  return (
    <AuthCard
      title={`Chào ${account.fullName}!`}
      subtitle={
        account.companyName
          ? `Đặt mật khẩu để vào TaskFlow của ${account.companyName}.`
          : 'Đặt mật khẩu để vào TaskFlow.'
      }
    >
      <ActivateForm
        token={token}
        account={account}
        onGone={() => setGone(true)}
        onDone={() => {
          toast({
            title: `Chào mừng ${callName(account.fullName) ?? account.fullName}!`,
            tone: 'success',
          });
          forgetActivationToken();
          router.replace('/w');
        }}
      />
    </AuthCard>
  );
}
