# T-038 — Module attendance (chấm công)

**Giao cho:** Engineer A (`taskflow-enterprise-64`) · **Mốc:** 3 · **Phụ thuộc:** T-037 (migration 3 + quyền)

## Nguồn
`docs/design/attendance-leave.md` §2 (ADR-120, 121), §4 (summarizeDay, 2 port), §5 (route attendance, hợp đồng web, thứ tự lỗi), §9 (dữ liệu nhạy cảm, CSV) · `docs/design/test-spec-hr.md` §1 SD-*, §5 AT-*, SEC-HR / CC-HR liên quan.

## Việc cần làm
1. Domain thuần `summarizeDay` (chữ ký §4, cờ `inProgress`, `absentHalf`) — viết test-first theo bảng SD; Stryker ≥ 90 %.
2. Lịch có phiên bản + ngày lễ (luật quá khứ), check-in/out (Idempotency-Key theo user, unique IN, OUT sau 00:00), `me/today` đủ trường cho web, `me?month=`.
3. HR: today, month (cursor 50), ADJUSTMENT/void (lý do, audit, thông báo qua port), export CSV (§9: không IP/UA, injection chỉ ô chữ, header, no-store, hạn mức, audit EXPORT).
4. Adapter cho `WorkCalendarPort` (leave sở hữu port); dùng `ApprovedLeavePort` (fake tới khi T-039 xong).

## Không làm
Máy chấm công (§7), OT, giới hạn IP/GPS.

## Done
verify + integration + security exit 0; SD/AT/SEC-HR/CC-HR phần attendance xanh. `DONE T-038`.
