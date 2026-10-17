import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { expectNoA11yViolations } from '@test/a11y';
import { openApp } from '@test/app-harness';
import { FakeRealtimeHub, seedBoard } from '@test/board-harness';
import { stubFetchXhr } from '@test/fetch-xhr';
import { API_BASE, startMockApi } from '@test/mock-api';
import { cleanupApp } from '@test/render';

import { getClientId } from '@/shared/lib/client-id';

vi.mock('next/navigation', async () => (await import('@test/navigation')).nextNavigationMock);

// T-071: /account "Ảnh đại diện" (avatar-chat.md ADR-142, §7 E1/E2/E4/E5; selector E2E-CH-01 của F). jsdom không có
// createImageBitmap / canvas ⇒ thay bằng bản giả ghi lại `drawImage`; XHR thay bằng bản chạy qua fetch (test/fetch-xhr.ts).

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const drawImage = vi.fn();

beforeEach(() => {
  drawImage.mockClear();
  stubFetchXhr();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width: 800, height: 600, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ fillRect: vi.fn(), drawImage, fillStyle: '', imageSmoothingQuality: 'low' }) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
    cb(new Blob([JPEG], { type: 'image/jpeg' })),
  );
});

let mock: ReturnType<typeof startMockApi>;
beforeAll(() => {
  mock = startMockApi({ now: () => Date.parse('2026-10-17T03:00:00.000Z') });
});
afterAll(() => mock.stop());
afterEach(() => {
  cleanupApp();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open() {
  const f = seedBoard(mock);
  const hub = new FakeRealtimeHub(mock.board, mock.db);
  f.signInAs(f.owner);
  openApp('/account', hub.client(getClientId(), f.owner.id));
  return f;
}

const photo = (type = 'image/jpeg') => new File([JPEG], 'ảnh của tôi.jpg', { type });
const lastSourceX = () => drawImage.mock.lastCall?.[1] as number;

describe('/account — ảnh đại diện', () => {
  it('chọn ảnh ⇒ dialog cắt (slider + phím) ⇒ lưu: tiến độ, toast, ảnh lớn hiện, header có ảnh; a11y', async () => {
    const f = open();
    const user = userEvent.setup();
    const region = await screen.findByRole('region', { name: 'Ảnh đại diện' });
    // Chưa có ảnh ⇒ chữ cái, chưa có nút gỡ.
    expect(within(region).getByRole('img', { name: f.owner.fullName }).tagName).toBe('SPAN');
    expect(within(region).queryByRole('button', { name: 'Gỡ ảnh đại diện' })).toBeNull();

    await user.upload(screen.getByLabelText('Chọn ảnh'), photo());
    const dialog = await screen.findByRole('dialog', { name: 'Cắt ảnh đại diện' });
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), {
      imageOrientation: 'from-image',
    });
    await expectNoA11yViolations(dialog);

    const centred = lastSourceX();
    fireEvent.change(within(dialog).getByRole('slider', { name: 'Thu phóng' }), {
      target: { value: '2' },
    });
    const zoomed = lastSourceX();
    expect(zoomed).toBeGreaterThan(centred);
    const frame = within(dialog).getByRole('img', { name: 'Vùng cắt ảnh' });
    frame.focus();
    await user.keyboard('{ArrowLeft}');
    expect(lastSourceX()).toBeLessThan(zoomed);

    await user.click(within(dialog).getByRole('button', { name: 'Lưu ảnh đại diện' }));
    expect(await screen.findByText('Đã cập nhật ảnh đại diện')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const large = await within(region).findByRole('img', { name: f.owner.fullName });
    await waitFor(() =>
      expect(large.getAttribute('src')).toContain(`/media/avatars/${f.owner.id}/256?v=1`),
    );
    const header = screen.getByRole('navigation', { name: 'Tài khoản' });
    await waitFor(() =>
      expect(header.querySelector('img')?.getAttribute('src')).toContain(
        `/media/avatars/${f.owner.id}/64?v=1`,
      ),
    );
    expect(mock.avatars.urlOf(f.owner.id, '64')).not.toBeNull();
  });

  it('gỡ ảnh ⇒ toast, về chữ cái; nút gỡ biến mất', async () => {
    const f = open();
    mock.avatars.set(f.owner.id, JPEG, 'image/jpeg');
    const user = userEvent.setup();
    const region = await screen.findByRole('region', { name: 'Ảnh đại diện' });
    await user.click(await within(region).findByRole('button', { name: 'Gỡ ảnh đại diện' }));
    expect(await screen.findByText('Đã gỡ ảnh đại diện')).toBeTruthy();
    await waitFor(() =>
      expect(within(region).getByRole('img', { name: f.owner.fullName }).tagName).toBe('SPAN'),
    );
    expect(within(region).queryByRole('button', { name: 'Gỡ ảnh đại diện' })).toBeNull();
  });

  it('tệp không phải JPG/PNG/WebP (vd GIF) ⇒ lời thường, không mở dialog', async () => {
    open();
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(await screen.findByLabelText('Chọn ảnh'), photo('image/gif'));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ảnh này chưa đọc được, hãy chọn ảnh JPG hoặc PNG.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ảnh hỏng (giải mã lỗi) ⇒ cùng lời thường', async () => {
    open();
    vi.mocked(createImageBitmap).mockRejectedValueOnce(
      new DOMException('bad', 'InvalidStateError'),
    );
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Chọn ảnh'), photo());
    expect((await screen.findByRole('alert')).textContent).toContain('chưa đọc được');
  });

  it('server bận xử lý ảnh (503 IMAGE_PROCESSING_BUSY — mã mới) ⇒ báo trong dialog, dialog vẫn mở để thử lại', async () => {
    open();
    mock.server.use(
      http.put(
        `${API_BASE}/me/avatar`,
        () =>
          HttpResponse.json(
            {
              success: false,
              error: { code: 'IMAGE_PROCESSING_BUSY', message: 'busy', details: null },
              meta: { timestamp: '2026-10-17T03:00:00.000Z', requestId: 'r' },
            },
            { status: 503, headers: { 'Retry-After': '5' } },
          ),
        { once: true },
      ),
    );
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Chọn ảnh'), photo());
    const dialog = await screen.findByRole('dialog', { name: 'Cắt ảnh đại diện' });
    await user.click(within(dialog).getByRole('button', { name: 'Lưu ảnh đại diện' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Máy chủ đang bận xử lý ảnh, hãy thử lại sau vài giây.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Lưu ảnh đại diện' }));
    expect(await screen.findByText('Đã cập nhật ảnh đại diện')).toBeTruthy();
  });

  it('Hủy ⇒ đóng dialog, không gửi gì', async () => {
    const f = open();
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Chọn ảnh'), photo());
    const dialog = await screen.findByRole('dialog', { name: 'Cắt ảnh đại diện' });
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mock.avatars.urlOf(f.owner.id, '64')).toBeNull();
  });
});
