'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { session } from '@/entities/session';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Dialog, DialogClose } from '@/shared/ui/dialog';

/** Đăng xuất mọi thiết bị (security.md §1.6): xác nhận ⇒ POST /auth/logout-all ⇒ kết thúc phiên. */
export function LogoutAllSection() {
  const [open, setOpen] = useState(false);
  const logoutAll = useMutation({ mutationFn: () => session.logoutAll() });

  return (
    <section aria-labelledby="logout-all-heading" className="flex flex-col gap-3">
      <h2 id="logout-all-heading" className="text-base font-semibold">
        Đăng xuất mọi thiết bị
      </h2>
      <p className="text-sm text-text-muted">
        Kết thúc mọi phiên đăng nhập của bạn, kể cả trên thiết bị này. Dùng khi bạn nghi ngờ tài
        khoản đang được dùng ở nơi khác.
      </p>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Đăng xuất mọi thiết bị?"
        description="Bạn sẽ phải đăng nhập lại trên tất cả thiết bị."
        trigger={
          <Button variant="danger" className="self-start">
            Đăng xuất mọi thiết bị
          </Button>
        }
        footer={
          <>
            <DialogClose>
              <Button variant="secondary">Hủy</Button>
            </DialogClose>
            <Button
              variant="danger"
              loading={logoutAll.isPending}
              onClick={() => logoutAll.mutate()}
            >
              Đăng xuất tất cả
            </Button>
          </>
        }
      >
        {logoutAll.isError && <Alert>Không đăng xuất được. Kiểm tra mạng và thử lại.</Alert>}
      </Dialog>
    </section>
  );
}
