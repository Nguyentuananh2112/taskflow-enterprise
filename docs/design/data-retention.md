# Thời hạn lưu dữ liệu cá nhân Mốc 3 (R27) — đề xuất để người dùng chốt TRƯỚC deploy

> Trạng thái: **ĐỀ XUẤT** (Engineer B soạn, chờ người dùng chốt). Câu hỏi cần chốt ở §6.
> Không phải tư vấn pháp lý: điều khoản viện dẫn bên dưới cần luật sư / kế toán của công ty xác nhận trước khi áp dụng.

## 1. Dữ liệu cá nhân Mốc 3 đang lưu

| # | Dữ liệu | Bảng / cột | Loại | Ai đọc | Vì sao cần |
|---|---|---|---|---|---|
| D1 | IP, User-Agent của lượt chấm web | `attendance_events.ip`, `user_agent` | cá nhân | chính chủ (`/me/events`), HR (`/events`) | đối chiếu khi có khiếu nại chấm công; không dùng ra quyết định |
| D2 | Giờ chấm vào / ra, lượt chỉnh / hủy (kèm ghi chú của HR) | `attendance_events` (trừ D1) | cá nhân | chính chủ, HR; tổng hợp trong CSV | tính công, tính lương |
| D3 | Lý do nghỉ (có thể là **sức khỏe**) | `leave_requests.reason` (tùy chọn, có thể NULL) | **nhạy cảm** | người gửi, HR | duyệt nghỉ |
| D4 | Đơn nghỉ (loại, ngày, trạng thái, người duyệt, ghi chú quyết định) + số dư phép | `leave_requests` (trừ D3), `leave_balances` | cá nhân | người gửi, HR | tính phép, tính lương |
| D5 | Nhiệm kỳ đã kết thúc (ngày vào, ngày rời, vai trò, lý do REMOVED/LEFT) | `workspace_member_departures` | cá nhân | hệ thống (bảng công), không có API đọc trực tiếp | không tính "Vắng" ngoài nhiệm kỳ |
| D6 | Thông báo trong app | `notifications` (chỉ id / loại / người gây ra; không có lý do nghỉ) | cá nhân (thấp) | người nhận | chuông |
| D7 | Nhật ký thao tác nhân sự | `hr_audit_logs` (trạng thái / ngày / số; ghi chú quản trị trong `after.note`; không có lý do nghỉ) | cá nhân | chỉ OWNER | trách nhiệm giải trình |
| D12 | Tin nhắn + tệp trò chuyện (Mốc 6) | thân tin, tệp đính kèm (blob trên ổ) | cá nhân (có thể nhạy cảm — người dùng tự gõ) | người tham gia cuộc trò chuyện; **không** Admin / HR qua app | liên lạc nội bộ |
| D13 | Ảnh đại diện | blob avatar (`avatars/<user>/<version>/…`), `users.avatar_version` | cá nhân | mọi người trong công ty (danh bạ — R49) | nhận diện |
| D14 | Metadata tệp | tên đã làm sạch, loại, kích thước, SHA-256, người gửi | cá nhân | như D12 | hiển thị, chống trùng, hạn mức |

Đã có sẵn (không cần quyết lại): lý do nghỉ không vào CSV / thông báo / log / audit; CSV không có IP/UA; mọi response `no-store`.

## 2. Căn cứ (cần xác nhận)

- **NĐ 13/2023/NĐ-CP** về bảo vệ dữ liệu cá nhân (và **Luật Bảo vệ dữ liệu cá nhân 2025** nếu đã có hiệu lực tại thời điểm deploy — luật sư xác nhận văn bản nào áp dụng, điều khoản chuyển tiếp):
  - dữ liệu về **tình trạng sức khỏe** là dữ liệu **nhạy cảm**: cần sự đồng ý rõ ràng, thông báo riêng cho chủ thể;
  - chủ thể phải được **thông báo** trước khi xử lý: mục đích, loại dữ liệu, thời hạn lưu, bên nhận;
  - chủ thể có quyền xem, yêu cầu xóa khi hết mục đích; chỉ giữ dữ liệu trong thời gian cần cho mục đích;
  - bên kiểm soát dữ liệu (công ty dùng TaskFlow) lập **hồ sơ đánh giá tác động** xử lý dữ liệu.
- **Nghĩa vụ lưu hồ sơ lao động / tiền lương**: bảng chấm công là căn cứ tính lương. Luật Kế toán 2015 và văn bản hướng dẫn đặt thời hạn lưu chứng từ kế toán tối thiểu **5 năm** (không dùng trực tiếp ghi sổ) hoặc **10 năm** (dùng trực tiếp ghi sổ). Kế toán xác nhận bảng công thuộc loại nào.
- **Thời hiệu tranh chấp lao động cá nhân** (BLLĐ 2019): khoảng **1 năm** kể từ ngày phát hiện vi phạm (yêu cầu trọng tài / tòa án). Đây là mốc tối thiểu để giữ chứng cứ đối chiếu (D1, D3).

**Hệ quả thiết kế:** nghĩa vụ lưu dài hạn (5–10 năm) áp cho **kết quả công / lương**, không áp cho dữ liệu đối chiếu (IP/UA) hay lý do nghỉ. Công ty có thể đáp ứng bằng **file CSV xuất hằng tháng lưu ở hệ thống kế toán**: CSV đã không chứa IP/UA và lý do nghỉ, nên TaskFlow không cần giữ dữ liệu thô tới 10 năm.

## 3. Phương án thời hạn

Mốc tính: D1/D2 theo `occurred_at`; D3/D4 theo `end_date` của đơn; D5 theo `left_at`; D6/D7 theo `created_at`.

| Dữ liệu | A — Tối thiểu hóa | **B — Khuyến nghị** | C — Giữ dài |
|---|---|---|---|
| D1 IP/UA | 90 ngày → NULL | **13 tháng → NULL** | 5 năm → NULL |
| D3 lý do nghỉ | NULL khi đơn kết thúc + 30 ngày | **NULL sau 13 tháng kể từ `end_date`** | giữ theo D4 |
| D2 lượt chấm, D4 đơn + số dư | 2 năm (công ty lưu CSV hằng tháng) | **2 năm** trong app (năm hiện tại + năm trước); công ty **bắt buộc** lưu CSV hằng tháng làm hồ sơ gốc | 10 năm trong app |
| D5 nhiệm kỳ đã kết thúc | xóa cùng D2 | **xóa cùng D2 (2 năm)** — cần cho bảng công chừng nào còn lượt chấm | 10 năm |
| D6 thông báo | 90 ngày | **180 ngày** | 1 năm |
| D7 HrAuditLog | 2 năm | **5 năm** (không chứa D1/D3) | 10 năm |
| D12 / D14 trò chuyện (Mốc 6 — **người dùng chốt 17/10**) | — | **12 tháng** kể từ `created_at` (`CHAT_RETENTION_DAYS=365`); tin bị xóa: thân NULL **ngay**, blob ≤ 1 giờ; upload mồ côi 24 giờ; purge ws cascade | — |
| D13 ảnh đại diện | — | tự xóa / bị gỡ / rời công ty ⇒ blob xóa sau **30 ngày** (đổi ảnh: bản cũ xóa khi version mới đã lên) | — |
| D15 hồ sơ lương, phiếu lương (Mốc 4 — TL chốt 18/10) | — | **10 năm** kể từ kỳ lương — chứng từ kế toán (Luật Kế toán 2015 Đ.41, NĐ 174/2016 Đ.12); giữ cả sau khi nghỉ việc; ẩn danh tài khoản vẫn giữ tên trên phiếu; lý do điều chỉnh (`overrideReason`) lưu cùng phiếu. v1 chưa có job xóa (phiếu cũ nhất mới vài tháng) — thêm trước khi chạm 10 năm | — |

**Khuyến nghị B** vì:
- 13 tháng phủ thời hiệu tranh chấp 1 năm cộng 1 tháng xử lý;
- dữ liệu nhạy cảm D3 không sống lâu hơn nhu cầu đối chiếu;
- app giữ đủ 2 năm cho HR xem lại và xuất lại, nghĩa vụ 5–10 năm do hồ sơ CSV của kế toán gánh;
- D7 dài hơn D2 để giữ trách nhiệm giải trình cho thao tác quản trị, mà không giữ lại dữ liệu nhạy cảm.

Hạn chế của B, cần người dùng chấp nhận: sau 2 năm HR không xuất lại được bảng công cũ từ app; phải lấy từ kho CSV của kế toán.

## 4. Cơ chế xóa / ẩn danh

Một job bảo trì `retention` theo mẫu T-033 (scheduler trong process API):
- chạy 1 lần/ngày, có jitter, `pg_try_advisory_xact_lock(<hằng số riêng>)` (không lấy được thì bỏ lượt), xử lý theo lô (vd 1 000 dòng/lô), idempotent, dừng sạch khi graceful shutdown;
- ngưỡng cấu hình qua env (mặc định = phương án được chốt); bật mặc định ở staging/production;
- thao tác:
  - D1: `UPDATE attendance_events SET ip = NULL, user_agent = NULL WHERE occurred_at < now() - <D1> AND (ip IS NOT NULL OR user_agent IS NOT NULL)`;
  - D3: `UPDATE leave_requests SET reason = NULL, decision_note = NULL WHERE end_date < <ngày> AND status <> 'PENDING'` — ghi chú quyết định của HR cũng có thể nhắc sức khỏe (góp ý D, T-043); CHECK not-blank của migration 4 cho phép NULL;
  - D7': bỏ khóa `note` khỏi `before` / `after` của `hr_audit_logs` theo mốc D3 (chữ tự do của người quản trị có thể nhắc sức khỏe — TL chốt T-043); dòng audit vẫn giữ tới mốc D7;
  - D2/D4/D5/D6/D7: `DELETE` theo mốc (D2 theo `work_date` — xóa trọn ngày công, review A T-043); xóa `leave_balances` của năm đã hết hạn cùng đơn;
- metrics/log: số dòng mỗi loại, thời gian chạy; không log nội dung dữ liệu;
- test tầng I: đúng ngưỡng (biên ±1 ngày), 2 instance chỉ 1 lượt chạy, không đụng dòng chưa hết hạn, đơn đang PENDING không bị xóa lý do.

Không thay đổi: xóa user / ẩn danh hóa tài khoản phải NULL IP/UA ngay (`attendance-leave.md` §9); purge workspace đã cascade toàn bộ.

## 5. Mẫu thông báo xử lý dữ liệu cho nhân viên

Hiển thị một lần khi nhân viên vào màn Chấm công / Nghỉ phép lần đầu (lưu lần xác nhận), và luôn xem lại được ở trang "Quyền riêng tư":

> **Thông báo về xử lý dữ liệu cá nhân — Chấm công & Nghỉ phép**
>
> **[Tên công ty]** (bên kiểm soát dữ liệu) xử lý các dữ liệu sau của bạn qua TaskFlow:
> - **Giờ chấm vào / ra** để tính công và tiền lương — lưu **2 năm** trên TaskFlow; bảng công tháng được lưu tại bộ phận kế toán theo quy định về lưu trữ chứng từ.
> - **Địa chỉ IP và thông tin trình duyệt** lúc chấm công, chỉ để đối chiếu khi có khiếu nại; không dùng để chấm điểm hay quyết định — tự động xóa sau **13 tháng**.
> - **Đơn nghỉ phép và số ngày phép.** **Lý do nghỉ là không bắt buộc.** Nếu bạn ghi lý do liên quan sức khỏe, đó là dữ liệu nhạy cảm: chỉ bạn và người được giao quản lý nhân sự xem được; không xuất hiện trong báo cáo, thông báo hay nhật ký; tự động xóa sau **13 tháng** kể từ ngày kết thúc đơn.
>
> Bạn có thể xem giờ chấm và thông tin IP của chính mình trong mục "Lịch sử chấm công". Để yêu cầu xem, sửa hoặc xóa dữ liệu, liên hệ **[đầu mối, email]**.
>
> ☐ Tôi đã đọc thông báo này. ☐ Tôi đồng ý để công ty xử lý lý do nghỉ (nếu tôi ghi) cho mục đích duyệt nghỉ.

(Thời hạn trong mẫu theo phương án B; đổi theo phương án được chốt.)

**Đoạn thêm khi bật Mốc 6 (ADR-147, B T-074)** — hiển thị trong cùng thông báo, lần đầu mở Trò chuyện:

> **Trò chuyện & ảnh đại diện**
> - Tin nhắn và tệp bạn gửi được lưu **12 tháng** rồi tự xóa. Tin bạn xóa biến khỏi ứng dụng ngay; bản sao lưu (đã mã hóa) có thể còn tới hết hạn giữ bản sao lưu.
> - Tin nhắn **không mã hóa đầu-cuối**: quản trị viên và nhân sự **không** đọc được trò chuyện của bạn qua ứng dụng, nhưng người vận hành máy chủ về kỹ thuật có thể truy cập dữ liệu lưu trữ. Đừng gửi mật khẩu, số thẻ hay thông tin sức khỏe qua trò chuyện.
> - Ảnh đại diện hiện cho mọi người trong công ty. Bạn đổi hoặc xóa được bất cứ lúc nào; khi bạn rời công ty ảnh bị xóa sau 30 ngày.
> - Muốn xem hoặc xóa trò chuyện của mình: liên hệ **[đầu mối]** — v1 xử lý thủ công, có biên bản (không có nút tự phục vụ).

**Đoạn thêm khi bật Mốc 4 (phiếu lương, TL 18/10)** — hiển thị trong cùng thông báo, lần đầu mở Phiếu lương:

> **Phiếu lương**
> - Công ty xử lý **hồ sơ lương** (bậc, lương cơ bản, phụ cấp) và **phiếu lương hằng tháng** của bạn để trả lương. Chỉ bạn, người được giao quyền Kế toán và quản trị viên xem được. Thông báo có phiếu mới **không** chứa số tiền.
> - Phiếu lương đã phát hành là chứng từ kế toán nên được lưu **10 năm** kể từ kỳ lương, kể cả sau khi bạn nghỉ việc.
> - Nếu kế toán điều chỉnh công hoặc lương của bạn, lý do điều chỉnh hiện trên phiếu để bạn xem và được lưu cùng phiếu.
> - Có thắc mắc về phiếu lương hoặc muốn yêu cầu sửa: liên hệ **[đầu mối]**.

## 6. Câu hỏi cần người dùng chốt

1. **Phương án thời hạn:** A, **B (khuyến nghị)** hay C? Có ngưỡng nào muốn đổi riêng không?
2. **Hồ sơ gốc bảng công:** công ty có cam kết lưu CSV xuất hằng tháng ở hệ thống kế toán không? Nếu không, phải chọn C cho D2/D4 (giữ 5–10 năm trong app).
3. **Đồng ý cho lý do nghỉ:** dùng ô đồng ý riêng như mẫu §5 (đề xuất), hay chỉ thông báo + giữ lý do là tùy chọn?
4. **Bên kiểm soát dữ liệu và đầu mối liên hệ** điền vào mẫu thông báo: tên công ty, người / email phụ trách.
5. **Pháp lý:** ai xác nhận §2 (văn bản áp dụng, loại chứng từ của bảng công) và lập hồ sơ đánh giá tác động? Đây là việc phải xong trước deploy Mốc 3.
