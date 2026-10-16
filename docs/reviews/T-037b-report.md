# T-037b — Nhiệm kỳ thành viên + lý do nghỉ tùy chọn — báo cáo Engineer B

Yêu cầu của TL: bảng công đang tính "Vắng" cho ngày trước khi gia nhập / sau khi rời, mà DB không lưu ngày
rời (rời = xóa dòng). Chữ ký port chốt với A (attendance sở hữu `IMembershipTenurePort`).

## Migration 4 — `20261018000000_member_tenure`

- Bảng `workspace_member_departures` (id, workspace_id FK cascade, user_id FK **Restrict**, role lúc rời,
  joined_at, left_at, reason `MemberDepartureReason { REMOVED, LEFT }`), index (ws, left_at), (ws, user), (user).
  CHECK `workspace_member_departures_range_chk` (left_at ≥ joined_at).
- `leave_requests.reason` DROP NOT NULL; `UPDATE … SET reason = NULL WHERE btrim(reason) = ''`; CHECK
  `leave_requests_reason_not_blank_chk` (NULL hoặc khác rỗng) — "không lý do" chỉ có MỘT biểu diễn (TL duyệt;
  thứ tự merge T-037 → T-037b → T-038 → T-039 nên D lưu null trực tiếp).

## Ghi departure

Đường xóa thành viên duy nhất là `RemoveMemberUseCase` (OWNER/PM xóa ⇒ `REMOVED`, tự rời ⇒ `LEFT`): ghi
departure TRONG `uow.run`, ngay trước `memberships.remove`. Purge workspace ⇒ cascade, không ghi.

## Port nhiệm kỳ (`module.tenure`, khớp cấu trúc `IMembershipTenurePort`)

```ts
tenuresOf({ workspaceId, userIds?, from: Date, to: Date }): Promise<{ userId; from: Date; until: Date | null }[]>
```

- Giao `[from, to)`: `tenure.from < to` VÀ (`until` null HOẶC `until ≥ from`); không cắt, không nới.
- Bỏ `userIds` ⇒ mọi nhân viên có nhiệm kỳ trong khoảng (gồm người đã rời); `[]` ⇒ `[]`.
- VIEWER: người hiện là VIEWER không có nhiệm kỳ hiện tại; departure rời khi là VIEWER bị bỏ.
- Sắp theo userId (so byte như Postgres) rồi from tăng dần.

**Hạn chế v1 (đã thống nhất với A):** đổi role không cắt nhiệm kỳ — người từng là MEMBER rồi bị hạ VIEWER
mất nhiệm kỳ khỏi kết quả. Attendance bù: ngày có lượt chấm chưa hủy vẫn tính, danh sách HR = nhiệm kỳ ∪ người có lượt chấm.

## Kiểm thử

- Unit `member-tenure.test.ts` (8) + LSP Postgres `lsp/workspace.member-tenure.lsp.int.ts`: REMOVED / LEFT;
  **rollback ⇒ không có departure**; LAST_OWNER ⇒ không ghi; **rời rồi vào lại ⇒ 2 nhiệm kỳ**; bỏ userIds gồm
  người đã rời, không VIEWER; `[]`; ws khác; biên `[from, to)`; VIEWER hiện tại / rời khi VIEWER; đổi role không cắt.
- `hr-constraints.int.ts`: reason NULL hợp lệ, '' / khoảng trắng ⇒ CHECK; departures range CHECK; FK Restrict.
- GR-11 (góp ý của F): `resolveActor` của HR = đúng 1 lần `memberships.find`, 0 lời gọi repo khác (adapters.test.ts).

## Lệnh đã chạy (exit code)

prettier 0 · eslint apps/api 0 · depcruise 0 · tsc api 0 · unit API 117 file / 1253 test 0 · integration chọn lọc
trên DB riêng (`lsp/workspace.*`, `constraints`, `hr-constraints`, `maintenance`) 14 file / 157 test 0.
