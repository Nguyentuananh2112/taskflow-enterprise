# T-050 — Web phiếu lương (Mốc 4) — báo cáo Engineer E

Nhánh `feat/T-050-payroll-web` @8b565049 (worktree T-025). TL đã gộp vào `feat/m4-payroll` = 039baf4a. Thiết kế: `docs/design/payroll.md` v4 §5. Contract: T-048 (B — DTO / route, `payslip:self`, `PAYSLIP_*`) và T-049 (A — `computePayslip`, thâm niên, `limits.ts`). Chưa push.

| Commit | Nội dung |
|---|---|
| `8b255f6` | Helper tiền VND (định dạng, hiểu khi dán "7,000,000" / "7.000.000"), mirror contract tạm |
| `05bc791` | entities/payroll (api, key, hook, nhãn), `PayslipSheet` theo mẫu, `/payslips` |
| `04d69fd` | `/payslips` chuyển sang contract T-048 thật (xóa mirror), mock phiếu nhân viên, ☰ Phiếu lương / Bảng lương |
| `70faf28` | Mock kế toán: cài đặt, hồ sơ lương, bảng tháng, phiếu, bản điều chỉnh, luật self |
| `d6545fc` | `/payroll`, `/payroll/YYYY-MM` |
| `8a6d49c` | `/payroll/YYYY-MM/[userId]` — form phiếu, bản điều chỉnh |
| `dd1aa5f` | `/payroll/profiles`, ô "Bảng lương" ở trang chính, lối tắt "Phiếu lương" |
| `2afcec1` | Lịch lễ: nhắc ngày bù khi lễ rơi ngày nghỉ; dòng hướng dẫn HR ở Đơn nghỉ |
| `90e4a58` | Sửa theo soát chéo của H (a11y "0 đồng", dialog Phát hành, ô tiền) |
| `5bb2b67` · `9dfab8f` · `8b56504` | Merge `feat/m4-payroll`, T-048 850ed51f / 33a58a0a; cổng quyền `payslip:self` |

## Đã làm

- **Nhân viên — `/payslips`** (§5.1):
  - mở thẳng phiếu mới nhất; `/payslips/YYYY-MM` là một tháng; ‹ › chỉ đi qua các tháng đã có phiếu; danh sách tháng bên dưới;
  - thẻ "Tổng thực lĩnh" trên cùng; phiếu đầy đủ theo mẫu (tên công ty in hoa · PHIẾU LƯƠNG NHÂN VIÊN · tháng; (1) (2) (3) (4); ghi chú; ghi chú SICK), không accordion;
  - `<table>` thật, nhãn dòng là `<th scope="row">`; ô 0 in "—", trình đọc màn hình đọc "0 đồng" (chữ sr-only);
  - bản điều chỉnh: dải "Đã điều chỉnh lần N ngày dd/mm — lý do"; `?rev=N` là bản cũ, nhãn "BẢN CŨ — đã được thay thế";
  - công sửa tay hiện lý do (TL dặn);
  - In / Lưu PDF + một dòng hướng dẫn;
  - title tab "Phiếu lương tháng 9/2026"; khi in đổi thành `Phieu-luong-YYYY-MM`; không tiền, không tên;
  - tháng chưa có phiếu: "Phiếu lương tháng M sẽ có trước ngày 10/M+1";
  - người không có `payslip:self` (Admin): "Tài khoản Quản trị không có phiếu lương".
- **Kế toán — `/payroll`** (§5.2, `payroll:manage`): các tháng (trạng thái bằng chữ, số phiếu, tổng thực lĩnh); nút tạo bảng tháng kế tiếp, mờ + "tạo được từ dd/mm" khi tháng chưa kết thúc.
- **Bảng tháng — `/payroll/YYYY-MM`**:
  - việc còn lại bằng lời thường; thiếu / sai ngày vào công ty ⇒ link Nhân viên nếu có `hr:manage`, không thì "báo HR bổ sung";
  - hạn phát hành ngày 10;
  - "Tính lại công": hỏi server trước ("N người thay đổi công") rồi mới áp; kỳ quá hạn lưu ⇒ chữ giải thích thay nút;
  - "Thêm người còn thiếu"; "Tải Excel";
  - "Phát hành": tóm tắt số phiếu + tổng + cảnh báo ngày quên chấm ra; ô "Tôi đã kiểm tra" bắt buộc, reset mỗi lần mở / đóng; 422 `PUBLISH_BLOCKED` liệt kê từng người + lý do (tên lấy từ bảng, server không gửi tên);
  - 360 px là danh sách thẻ; desktop là bảng, cột tên dính trái; phiếu của chính kế toán ghi "Kế toán khác hoặc Admin sửa".
- **Phiếu 1 người — `/payroll/YYYY-MM/[userId]`**:
  - form theo bố cục phiếu: lương theo công + thâm niên (chỉ đọc, "Hệ thống tính theo ngày vào công ty") + dòng gõ tay theo từng mục (nhãn + số tiền, xếp dọc ở 360 px);
  - ô tiền: bàn phím số, chấm nghìn khi gõ / dán, dấu trừ ⇒ báo lỗi dưới ô, chữ cái ⇒ lỗi ở đúng ô; tên ô có tên mục;
  - tổng xem trước bằng chính `computePayslip`;
  - sửa công: bước 0,5 ngày, không quá công chuẩn, lý do bắt buộc + "Nhân viên sẽ thấy lý do này — không ghi chẩn đoán/bệnh";
  - Lưu theo phiếu (`expectedLockVersion`), 409 ⇒ giữ số đã gõ + "Tải bản mới"; rời trang khi chưa lưu ⇒ trình duyệt hỏi;
  - phiếu của chính kế toán chỉ đọc;
  - đã phát hành ⇒ "Tạo bản điều chỉnh": lý do bắt buộc, "Xem khác biệt" ((1)–(4) cũ → mới) rồi mới gửi (`expectedRevision`).
- **Hồ sơ lương — `/payroll/profiles`**:
  - phiên bản theo tháng + lịch sử; "Đổi lương" (tháng áp dụng, cấp bậc, lương cơ bản); trùng tháng ⇒ 409 lời thường;
  - ngày vào công ty chỉ đọc ("HR sửa ở Nhân sự → Nhân viên");
  - hồ sơ của chính kế toán chỉ đọc;
  - mức phụ cấp thâm niên / năm của công ty.
- **Điều hướng**: ☰ theo thứ tự chốt (… Hồ sơ của tôi · Phiếu lương · Trò chuyện · Nhân sự · Bảng lương · Quản trị); "Bảng lương" ở khối Việc quản lý; lối tắt "Phiếu lương" ở trang chính (ô thứ 4 của lưới 2 cột — không đổi chiều cao, E2E-HR-14).
- **Cache / riêng tư**: key `['company', 'payroll', …]` / `['company', 'payslips', …]`, staleTime 0 + gcTime 60 s; route Next `force-dynamic`; mock trả `no-store`; không tiền trong URL / title / storage.
- **Khác (§8 T-050)**: lịch lễ — lễ rơi ngày nghỉ (theo phiên bản lịch hiệu lực) ⇒ "nếu có nghỉ bù, thêm ngày bù vào lịch lễ"; tab Đơn nghỉ — dòng hướng dẫn "đã chấm công nhưng có đơn nghỉ không lương ⇒ không tính công; thực tế đi làm thì thu hồi đơn".
- **Mock-api**: đủ route T-048 (bảng tháng chỉ tạo khi tháng đã qua; blockers; luật self tuyệt đối; lockVersion; bản điều chỉnh copy công của bản trước; nhân viên chỉ thấy bảng đã phát hành). Tiền tính bằng `computePayslip`; công rút gọn (2 nửa / ngày có mặt hoặc lễ ngày làm).

## Quyết định / ghi chú

1. Ngày vào công ty trong mock payroll lấy qua `hireDateOf` (nối hồ sơ khi có) — nhánh Mốc 4 lúc làm chưa có hồ sơ (T-054).
2. "Tháng áp dụng" mặc định của hồ sơ lương lấy theo giờ máy — chỉ là giá trị gợi ý, server kiểm.
3. Thông báo `PAYSLIP_*` dùng câu chữ của B, href `/payslips`. Chờ A thêm `payslip: { period }` vào NotificationDto (join lúc đọc) ⇒ đổi sang `/payslips/YYYY-MM`.
4. Không làm (ngoài phạm vi v1): autocomplete nhãn dòng (tùy chọn).

## Phát hiện khi gộp contract (đã báo, đã sửa)

- `PayslipSection` / `PayslipLineInput` trùng tên giữa payslip-math (A) và payroll.schemas (B) ⇒ A đổi `PayslipMathLine`.
- `MAX_PAYSLIP_LINES` (A) / `PAYSLIP_MAX_LINES` (B) cùng nghĩa ⇒ TL chốt giữ `MAX_PAYSLIP_LINES`.
- Vòng import payroll.schemas ↔ payslip-math (lint:deps đỏ) ⇒ A tách `limits.ts` (2a4534d).
- Nhánh T-048 của B (33a58a0a) vẫn khai `PAYSLIP_SECTIONS` inline + `PAYSLIP_MAX_LINES`; bản đúng ở T-049 / T-050.

## Kết quả lệnh (worktree T-025, chỉ việc nhẹ)

- `pnpm install --frozen-lockfile` 0; `prisma generate` 0 (sau khi người dùng cho phép pnpm prisma).
- web `tsc --noEmit` 0; contracts `tsc` 0; `eslint src test app` 0; `lint:deps` 0 vi phạm.
- vitest web tập liên quan sau merge cuối: 64 file, 503/503, exit 0; contracts 206/206.
- Test mới: `test/my-payslips`, `payroll-runs`, `payslip-edit`, `payroll-profiles`; mock `payroll-api.test.ts`; `shared/lib/money.test.ts`; `entities/hr/lib/workday.test.ts`.
- CHƯA: full web vitest trên nhánh cuối, `pnpm verify`, Playwright (E2E-PAY-01…09 của H/F chạy ở cổng Mốc 4 của TL).

## Còn chờ / rủi ro

- Cảnh báo MISSING_OUT trên thẻ / trang chấm công + nút "Xin bổ sung giờ ra" (§5.1): cần T-058b trên nhánh Mốc 4 — làm khi TL gộp m5 → m4.
- Link thông báo phiếu đúng tháng: chờ A (T-049).
- Mock công rút gọn ⇒ số công trên web chỉ đúng với server ở ca có mặt / lễ; phép có lương và MISSING_OUT do API thật (A) tính — E2E-PAY kiểm.
- Chưa xem trên trình duyệt thật / điện thoại; in A4 chưa kiểm thủ công.
