# F3-m3 — Mutation testing Mốc 3: `attendance-domain`, `leave-domain`

**Người chạy:** F (QA độc lập), theo lượt Tech Lead cấp 2026-10-17 01:10–03:25.
**Snapshot:** main `fec8215`.

**Cách chạy:**

- Lệnh: `pnpm --filter @taskflow/api exec stryker run stryker/<nhóm>.config.mjs --concurrency 1`.
- Môi trường: `METRICS_PORT=0`, không đụng 3001/4000/5435.
- Runner: command runner của T-017 (`base.mjs`), mỗi mutant chạy lại toàn bộ test của module.

**Mục tiêu:** ≥ 90 % mỗi nhóm.

## Kết quả

| Nhóm                | Mutant | Killed | Timeout | Survived | No cov | **Điểm** | Điểm bỏ EQ | Thời gian |
| ------------------- | -----: | -----: | ------: | -------: | -----: | -------: | ---------: | --------: |
| `attendance-domain` |    307 |    278 |       0 |       29 |      0 | **90,55 %** |     93,3 % |    6 phút |
| `leave-domain`      |    200 |    179 |       3 |       18 |      0 | **91,00 %** |     94,3 % |    4 phút |

Cả hai nhóm **đạt ngưỡng**.

### Ghi chú về phạm vi test

Lượt đầu chỉ chạy test của thư mục `domain`:

- `attendance-domain`: vẫn 90,55 %.
- `leave-domain`: chỉ 85,00 %, vì `overlaps` và `leaveDatesWithin` được phủ qua use case.

Bảng trên lấy từ lượt chạy cả module, giống các nhóm F3 trước. Lý do có thể làm vậy: bộ test của mỗi module chạy dưới 1,1 s (attendance 121 test, leave 93 test).

Với attendance, test của module **không giết thêm** mutant nào. Vì vậy 29 mutant còn sống là khoảng trống thật của bộ test unit.

### Phân loại mutant còn sống

- **GAP:** thiếu test, nên thêm.
- **EQ:** tương đương, không có test nào phân biệt được.
- **LOW:** chỉ đổi chuỗi hiển thị, hoặc là biên rất hẹp.

## `attendance-domain`: 29 mutant sống, chủ module là A

### GAP: 17 mutant, 5 nhóm

| #   | Vị trí                     | Mutant sống                                                                                     | Ca test đề xuất                                                                                                                                                                                                                                   |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `work-date.ts:31` (×2)      | `if (kind === 'IN') return today` → `false` / `''`: IN đi qua nhánh OUT                         | IN 08:00 ngày 16/11 còn mở, rồi **IN 05:00 ngày 17/11** (trước giờ chốt 06:00) ⇒ lượt IN mới phải thuộc **17/11**. Mutant gắn nó vào 16/11.                                                                                                          |
| A2  | `work-date.ts:35` (×4)      | Chọn `lastIn`: `true` (luôn lấy phần tử cuối), `false`, `>=`, `<=`                              | `previous` **không theo thứ tự thời gian**: doc ghi "thứ tự bất kỳ", nhưng test luôn đưa vào theo thứ tự. Ví dụ `[IN 16/11 08:00, IN 15/11 08:00]` rồi OUT 00:30 ngày 17/11 ⇒ phải gắn 16/11.                                                       |
| A3  | `work-date.ts:38` (×7)      | Điều kiện `closed`: thay từng vế bằng `true`, đổi `&&`/`\|\|`, `>` → `>=`                        | IN 08:00 → OUT 12:00 → **IN lại 13:00** cùng ngày 16/11 (qua ADJUSTMENT), rồi OUT 00:30 ngày 17/11 ⇒ phải gắn **16/11**, vì IN 13:00 còn mở. Mutant tính cả OUT 12:00 nên coi ngày đã đóng, và OUT thành mồ côi. Thêm biến thể có OUT của ngày khác nằm sau `lastIn`. |
| A4  | `summarize-day.ts:75` (×2)  | `outs = live.filter(kind === 'OUT')` → `live` / `true`: lượt IN cũng được coi là OUT            | IN 08:00 · OUT 12:00 · IN 13:00 (không OUT) ⇒ `lastOut` = 12:00, không phải 13:00. Ca này cũng kiểm `MISSING_OUT` / `inProgress`.                                                                                                                   |
| A5  | `summarize-day.ts:142` (×2) | `scheduledMinutes`: `−` → `+`                                                                   | Kiểm giá trị cụ thể: S0 08:00–17:30, nghỉ 12:00–13:30 ⇒ **480**. Hiện hàm chỉ được dùng làm cận trên cho thuộc tính "worked ≤ …", nên nếu hàm trả số lớn hơn thì vẫn qua.                                                                             |

### EQ: 9 mutant

| Vị trí                                         | Vì sao tương đương                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-time.ts:15`, `:25`                      | Cache `Intl.DateTimeFormat` (bỏ `if (!f)` / bỏ `set`): kết quả giống hệt, chỉ chậm hơn.                                                                                   |
| `summarize-day.ts:70`, `:72`                   | `<` ↔ `<=` khi chọn IN sớm nhất / OUT muộn nhất: hai lượt trùng đúng một ms cho cùng `occurredAt`, nên đầu ra như nhau.                                                     |
| `summarize-day.ts:78`                          | Trạng thái khởi tạo `'PENDING'` → `''`: mọi nhánh đều ghi đè `status` trước khi trả.                                                                                       |
| `work-date.ts:43`                              | `lastIn.workDate === today` → `false`: cùng ngày thì `cutoff` (tính từ 00:00 ngày mai) luôn âm, nên `< 360` vẫn đúng.                                                       |
| `work-date.ts:45`                              | Vế `lastIn.workDate !== today` → `true`: chỉ khác khi `closed` và cùng ngày, mà khi đó `today === lastIn.workDate`.                                                         |
| `work-schedule.ts:30`                          | `effectiveFrom: '1970-01-01'` → `''`: `'' <= date` vẫn đúng với mọi ngày.                                                                                                  |
| `work-schedule.ts:55`                          | `>` → `>=` giữa các phiên bản cùng `effectiveFrom`: có unique `(workspace_id, effective_from)` nên không thể xảy ra.                                                         |

### LOW: 3 mutant

| Vị trí                     | Ghi chú                                                                                                                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-time.ts:86` (×2)     | Lần đoán offset đầu tiên của `instantOf` (`−` → `+`, `*` → `/`). Lần lặp thứ hai sửa lại trừ khi có giờ đổi DST nằm trong khoảng ±2×offset. Muốn kill thì cần một ca Europe/Berlin đúng giờ nhảy, cách đều hai phía. VN không có DST. |
| `work-date.ts:32`          | `occurredAt <= now` → `<`: lượt trước trùng đúng thời điểm lượt mới. Thực tế không xảy ra, vì Idempotency-Key và unique index chặn.                                                                                            |

## `leave-domain`: 18 mutant sống, chủ module là D

### GAP: 3 mutant

| #   | Vị trí                 | Mutant sống                                                                    | Ca test đề xuất                                                                                                                                                                                                                       |
| --- | ---------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | `leave-days.ts:112`    | `leaveDatesWithin`: `end = span.endDate < to ? … : to` → luôn lấy `span.endDate` | Đơn 29/11–03/12, hỏi trong khoảng `[01/11, 30/11]` ⇒ chỉ trả 29/11 và 30/11. Bảng công tháng của attendance dùng đúng hàm này (ApprovedLeavePort), nên mutant làm tháng 11 hiện thêm ngày của tháng 12.                              |
| L2  | `leave-days.ts:113`    | `if (end < start) return []` → trả `['Stryker was here']`                      | Đơn nằm **hẳn ngoài** khoảng hỏi ⇒ trả `[]`. (Biến thể `false` của cùng dòng là EQ, vì `datesBetween` với `end < start` cũng rỗng.)                                                                                                   |
| L3  | `leave-errors.ts:15`   | `LeaveConflictError.code` `'RESOURCE_CONFLICT'` → `''`                         | Unit test chỉ kiểm `instanceof` / `details.reason`, chưa kiểm `code`, trong khi FE rẽ nhánh theo `code` + `details.reason`. Hộp đen đã phủ ca này (`expectLoser` của CC-HR-05/09 kiểm `code`). Nên thêm một assert ở `leave-status.test.ts`. |

### EQ: 7 mutant

| Vị trí                             | Vì sao tương đương                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `leave-days.ts:97` (×4)            | Early return của `overlaps` chỉ để chạy nhanh. Bỏ hoặc đổi điều kiện thì phép so ô `(ngày, phần)` phía sau vẫn cho cùng kết quả.                                        |
| `leave-days.ts:111` (`>=`)         | `start` = max(`span.startDate`, `from`): khi hai giá trị bằng nhau, chọn bên nào cũng như nhau.                                                                          |
| `leave-days.ts:112` (`<=`)         | Tương tự với `end` = min.                                                                                                                                               |
| `leave-days.ts:113` (`false`)      | Bỏ early return: `datesBetween(start, end)` với `end < start` vẫn rỗng.                                                                                                 |

### LOW: 8 mutant (chỉ đổi chuỗi)

`leave-balance.ts:69`, `leave-days.ts:48`, `:57`, `:64`, `leave-errors.ts:20`, `leave-status.ts:51` đổi message hiển thị thành `''`. Hai mutant còn lại là `leave-days.ts:47`, `:56`, đổi `code` của issue validation (`too_small`, `invalid_value`).

- Phần test đã kiểm: loại lỗi và `path` / `rule`.
- Phần chưa kiểm: nội dung chữ.
- Không bắt buộc. Nếu FE hiển thị message của server cho các ô này thì nên có ít nhất một snapshot message.

## Việc tiếp theo

- **A:** viết các ca A1–A5. Ưu tiên A1 và A3, là hai ca có thể gặp thật: IN trước 06:00 khi hôm qua còn mở; vào lại trong ngày rồi ra qua nửa đêm. Nếu A thấy hành vi hiện tại đúng thì xác nhận bằng test.
- **D:** viết L1–L3. L1 ảnh hưởng trực tiếp tới bảng công tháng khi một đơn vắt qua cuối tháng.
- **F:** chạy lại hai nhóm sau khi A và D thêm test, khi Tech Lead cấp lượt.
- Hai nhóm mới đã có script `mutation:attendance-domain` / `mutation:leave-domain` trong `apps/api/package.json`, và config trong `apps/api/stryker/`.
