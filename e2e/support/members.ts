import { expect, type Page } from '@playwright/test';

import { awaiting, test, type E2EUser } from './fixtures';

/**
 * T-065c (E @8934d52): thêm thành viên ws bằng combobox "Tìm nhân viên" — chỉ người thuộc công ty (ADR-134), thay ô
 * "Email" cũ. Gõ ≥ 2 ký tự (debounce 300 ms) ⇒ option "{fullName} · {email}"; "Thêm" tắt tới khi chọn người.
 * Tìm theo email (duy nhất mỗi ca) — tên E2E trùng tiền tố giữa các ca trong một công ty.
 */
export async function addMemberViaUi(
  page: Page,
  member: E2EUser,
  roleLabel: string,
): Promise<void> {
  test.fixme(awaiting('T-061a'), '[PENDING T-061a] GET member-candidates — API A');
  const form = page.getByRole('form', { name: 'Thêm thành viên' });
  const add = form.getByRole('button', { name: 'Thêm', exact: true });
  await expect(add).toBeDisabled();
  await form.getByRole('combobox', { name: 'Tìm nhân viên' }).fill(member.email);
  await page.getByRole('option', { name: `${member.fullName} · ${member.email}` }).click();
  await form.getByLabel('Vai trò').selectOption({ label: roleLabel });
  await expect(add).toBeEnabled();
  await add.click();
}

export const NO_CANDIDATE = 'Không có nhân viên phù hợp (hoặc đã ở workspace này).';
