# T-039 — Module leave (nghỉ phép)

**Giao cho:** Engineer D (`taskflow-enterprise-6a`) · **Mốc:** 3 · **Phụ thuộc:** T-037

## Nguồn
`docs/design/attendance-leave.md` §2 (ADR-122), §5 (route leave), §9 (bảng chuyển trạng thái, khóa & số học, luật self) · `docs/design/test-spec-hr.md` §2 LD-*, §3 LV-*, §4 LB-*, CC-HR phần leave.

## Việc cần làm
1. Domain thuần: đếm ngày (số nguyên nửa ngày), máy trạng thái theo bảng §9 (409 `invalid_transition`), công thức số dư — test-first.
2. Use case submit / cancel / approve / reject / revoke, PATCH balance — cùng advisory lock, `version`, `requester_not_member`, `no_working_days`, lý do nghỉ chỉ người gửi + HR đọc.
3. Sở hữu `WorkCalendarPort` (fake tới khi T-038 xong); adapter cho `ApprovedLeavePort` của attendance.
4. Thông báo qua port của T-040 (fake tới khi xong).

## Done
verify + integration + security exit 0; LD/LV/LB + 4 ca race của D xanh (×20). `DONE T-039`.
