import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { chatKeys } from '@/entities/chat';

import { forget } from './use-chat-realtime';

// Mất quyền một hội thoại (removed / bù 404 — B L1/L2): xóa cache và cho biết người dùng có đang xem nó không.

const CONV = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WS = '33333333-3333-4333-8333-333333333333';

function seeded() {
  const qc = new QueryClient();
  qc.setQueryData(chatKeys.messages(CONV), { pages: [], pageParams: [] });
  qc.setQueryData(chatKeys.detail(CONV), { id: CONV });
  qc.setQueryData(chatKeys.wsRoom(WS), { id: CONV });
  return qc;
}

describe('forget', () => {
  it('xóa tin + chi tiết; đang ở /chat/[id] đúng hội thoại ⇒ true', () => {
    const qc = seeded();
    expect(forget(qc, CONV, `/chat/${CONV}`)).toBe(true);
    expect(qc.getQueryData(chatKeys.messages(CONV))).toBeUndefined();
    expect(qc.getQueryData(chatKeys.detail(CONV))).toBeUndefined();
  });

  it('đang ở /chat/ws/[wsId] mà phòng là hội thoại này ⇒ true + quên phòng (B L2)', () => {
    const qc = seeded();
    expect(forget(qc, CONV, `/chat/ws/${WS}`)).toBe(true);
    expect(qc.getQueryData(chatKeys.wsRoom(WS))).toBeUndefined();
  });

  it('đang xem hội thoại / phòng khác ⇒ false, phòng ws không bị xóa', () => {
    const qc = seeded();
    expect(forget(qc, OTHER, `/chat/ws/${WS}`)).toBe(false);
    expect(qc.getQueryData(chatKeys.wsRoom(WS))).toEqual({ id: CONV });
    expect(forget(qc, OTHER, `/chat/${CONV}`)).toBe(false);
    expect(forget(qc, CONV, '/w')).toBe(false);
  });
});
