# E4 — Báo cáo: rà chuỗi tiếng Việt toàn app

**Người làm:** Engineer E (`taskflow-enterprise-54`) · **Branch:** `feat/E4-vi-strings` (từ main) · **Ngày:** 2026-10-15

## Phạm vi & cách rà
Rà tĩnh `apps/web/src` (mọi `.tsx/.ts`, bỏ test và mock API):
1. Chuỗi tiếng Anh hiển thị cho người dùng (nội dung JSX, `label`/`title`/`placeholder`/`aria-label`/`description`).
2. Mã lỗi kỹ thuật hoặc `error.message` của server lọt ra UI.
3. Giá trị enum thô (`status`/`priority`/`role`) render thẳng.
4. Thuật ngữ nhất quán: dự án/project, task/công việc, hạn chót, người phụ trách.

## Kết quả
| Hạng mục | Kết quả |
|---|---|
| Chuỗi tiếng Anh | Chỉ còn từ mượn đã dùng trong tài liệu thiết kế: "Email", "Slug", "Workspace" — giữ nguyên. |
| Mã lỗi / thông điệp server | Không còn chỗ nào render `error.message`; câu lỗi đi qua `form-errors.ts` (theo `code` / `issue.code`, review B F2 của T-034). Toast dùng nhãn (`STATUS_LABEL`, `ROLE_LABEL`), không in mã. |
| Enum thô | Không có — `PriorityBadge`, `STATUS_LABEL`, `ROLE_LABEL`; `value={…}` của `<select>` là giá trị form, không phải chữ hiển thị. |
| Thuật ngữ | "dự án" (không lẫn "project" trong chữ hiển thị); "task" cho đơn vị việc trên board, "công việc" chỉ dùng nghĩa chung (tiêu đề sr-only "Bảng công việc", landing/đăng ký); "Hạn chót" thống nhất 5/5 chỗ; "Người phụ trách" thống nhất. |

Không có thay đổi code. Hạng mục cần mắt người (văn phong, độ dài chuỗi trên màn hẹp) gộp vào lượt kiểm trực quan của E3 (360/768/1440px, sáng/tối) khi máy rảnh để build prod.
