# Chính sách bảo mật

## Báo lỗ hổng

**Không mở issue, pull request hay thảo luận công khai cho lỗ hổng bảo mật.**

Dùng kênh riêng của GitHub: tab **Security → Report a vulnerability** của repo này (GitHub private vulnerability reporting). Báo cáo chỉ người duy trì dự án đọc được.

Vui lòng gửi:

- mô tả lỗ hổng và tác động (ai bị ảnh hưởng, đọc/sửa được gì);
- các bước tái hiện tối thiểu (request, payload, phiên bản / commit);
- nếu có: đề xuất cách sửa.

**Không** dùng dữ liệu thật của người khác, không tấn công từ chối dịch vụ, không thử trên môi trường production — dựng bản local theo [docs/runbook/local-dev.md](docs/runbook/local-dev.md) để kiểm.

## Phạm vi

| Trong phạm vi                                                                                                                | Ngoài phạm vi                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mã trong repo này: `apps/api`, `apps/web`, `packages/*`, image Docker, cấu hình mẫu                                          | Lỗ hổng của thư viện bên thứ ba chưa có cách khai thác qua TaskFlow (báo cho dự án gốc) |
| Xác thực / phiên, phân quyền và cô lập tenant (IDOR), realtime, rate limit, CSP / XSS, rò dữ liệu qua log / Sentry / metrics | Thiếu header "best practice" không dẫn tới khai thác cụ thể                             |
| Secret lọt trong lịch sử git                                                                                                 | Tấn công vật lý, lừa đảo người dùng                                                     |

Tính năng chưa có ở v1 (vd xác minh email — ADR-049) được ghi nhận là rủi ro đã chấp nhận, không tính là lỗ hổng.

## Phiên bản được hỗ trợ

Chỉ nhánh `main` mới nhất. Bản vá được phát hành trên `main`.

## Cam kết của chúng tôi

- Xác nhận đã nhận báo cáo, đánh giá mức độ và thông báo hướng xử lý.
- Ghi công người báo (nếu bạn muốn) khi công bố bản vá.
- Không có cam kết phản hồi ngoài giờ ở v1 (kênh cảnh báo là email — ADR-073).

## Tài liệu liên quan

- Thiết kế bảo mật: [docs/design/security.md](docs/design/security.md)
- Checklist bảo mật trước khi go-live và quy trình xử lý sự cố (gồm lộ secret): [docs/runbook/security-go-live.md](docs/runbook/security-go-live.md)
