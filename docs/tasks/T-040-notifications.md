# T-040 — Module notifications (trung tâm thông báo)

**Giao cho:** Engineer B (`taskflow-enterprise-d1`) · **Mốc:** 3 · **Phụ thuộc:** T-037

## Nguồn
`docs/design/attendance-leave.md` §2 (ADR-123), §5 (route me/notifications, DTO có ngữ cảnh), §9 (lọc theo quyền hiện tại, IDOR) · `docs/design/test-spec-hr.md` SEC-HR notifications.

## Việc cần làm
Port `NotificationPort` (ghi trong transaction của bên gọi) cho attendance/leave; fan-out tới mọi `hr:manage` (trừ người gây ra); `notification:new` sau commit; list (cursor) / unread-count / read / read-all với `recipientId = me` trong WHERE; DTO join tên workspace, actor, loại + khoảng ngày (không lý do); lọc loại "dành cho HR" theo quyền hiện tại.

## Done
verify + integration + security exit 0. `DONE T-040`.
