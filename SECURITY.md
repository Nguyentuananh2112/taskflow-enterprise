# Chính sách bảo mật

_English version below._

## Báo lỗ hổng

**Không mở issue, pull request hay thảo luận công khai cho lỗ hổng bảo mật.**

Dùng kênh riêng của GitHub: tab **Security → Report a vulnerability** của repo này (GitHub private vulnerability reporting). Báo cáo chỉ người duy trì dự án đọc được.

Nếu nút "Report a vulnerability" không có: mở một issue **chỉ** với tiêu đề "Xin kênh liên hệ bảo mật" — **không** kèm bất kỳ chi tiết nào về lỗ hổng; người duy trì sẽ liên hệ lại qua kênh riêng.

> **Người duy trì:** tính năng _Private vulnerability reporting_ **tắt mặc định** — bật ở Settings → Code security → Private vulnerability reporting **trước khi** công khai repo (checklist: [docs/runbook/security-go-live.md](docs/runbook/security-go-live.md)).

Vui lòng gửi:

- mô tả lỗ hổng và tác động (ai bị ảnh hưởng, đọc/sửa được gì);
- các bước tái hiện tối thiểu (request, payload, phiên bản / commit);
- nếu có: đề xuất cách sửa.

## Thời hạn xử lý và công bố phối hợp

| Mốc                            | Cam kết                              |
| ------------------------------ | ------------------------------------ |
| Xác nhận đã nhận báo cáo       | trong **5 ngày làm việc**            |
| Đánh giá mức độ + hướng xử lý  | trong **10 ngày làm việc**           |
| Bản vá cho mức High / Critical | mục tiêu **30 ngày** từ khi xác nhận |

**Công bố phối hợp:** xin chờ bản vá được phát hành, tối đa **90 ngày** kể từ khi báo, trước khi công bố công khai — hoặc sớm hơn nếu hai bên thống nhất. Chúng tôi ghi công người báo (nếu bạn muốn) khi công bố.

Không có cam kết phản hồi ngoài giờ ở v1 (kênh cảnh báo là email — ADR-073).

## Bến an toàn (safe harbor)

Nghiên cứu **thiện chí, trong phạm vi** dưới đây và tuân thủ quy tắc kiểm thử sẽ không bị chúng tôi khởi kiện hay khiếu nại. Quy tắc kiểm thử:

- dựng bản local theo [docs/runbook/local-dev.md](docs/runbook/local-dev.md) để kiểm — **không** thử trên môi trường production;
- không truy cập, sửa hay giữ dữ liệu thật của người khác; không tấn công từ chối dịch vụ, không spam, không lừa đảo;
- dừng ngay và báo cáo khi chạm tới dữ liệu không phải của bạn.

## Phạm vi

| Trong phạm vi                                                                                                                | Ngoài phạm vi                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Mã trong repo này: `apps/api`, `apps/web`, `packages/*`, image Docker, cấu hình mẫu                                          | Lỗ hổng của thư viện bên thứ ba chưa có cách khai thác qua TaskFlow (báo cho dự án gốc) |
| Xác thực / phiên, phân quyền và cô lập tenant (IDOR), realtime, rate limit, CSP / XSS, rò dữ liệu qua log / Sentry / metrics | Thiếu header "best practice" không dẫn tới khai thác cụ thể                             |
| Secret lọt trong lịch sử git                                                                                                 | Tấn công vật lý, lừa đảo người dùng                                                     |

Tính năng chưa có ở v1 (vd xác minh email — ADR-049) là rủi ro đã chấp nhận có chủ đích, không tính là lỗ hổng.

## Phiên bản được hỗ trợ

Chỉ nhánh `main` mới nhất. Bản vá được phát hành trên `main`.

## Tài liệu liên quan

- Thiết kế bảo mật: [docs/design/security.md](docs/design/security.md)
- Checklist bảo mật trước khi go-live và quy trình xử lý sự cố (gồm lộ secret): [docs/runbook/security-go-live.md](docs/runbook/security-go-live.md)

---

# Security policy (English)

## Reporting a vulnerability

**Do not open public issues, pull requests or discussions for security vulnerabilities.**

Use GitHub's private channel: the **Security → Report a vulnerability** tab of this repository (private vulnerability reporting). Only maintainers can read the report.

If the "Report a vulnerability" button is not available, open an issue titled **only** "Request for a security contact" — with **no** details about the vulnerability — and a maintainer will reach out privately.

Please include: a description and impact (who is affected, what can be read or changed), minimal reproduction steps (requests, payloads, version / commit), and a suggested fix if you have one.

## Response timeline and coordinated disclosure

- Acknowledgement within **5 business days**; assessment and plan within **10 business days**; fix for High / Critical issues targeted within **30 days** of acknowledgement.
- Please allow up to **90 days** from your report (or until a fix is released, if sooner, or another date we agree on) before public disclosure. We will credit you if you wish.

## Safe harbor

We will not pursue legal action against **good-faith research within the scope below** that follows these rules: test only against a local deployment (see `docs/runbook/local-dev.md`), never against production; do not access, modify or retain other people's real data; no denial of service, spam or social engineering; stop and report as soon as you encounter data that is not yours.

## Scope

In scope: code in this repository (`apps/api`, `apps/web`, `packages/*`, Docker images, sample configuration) — authentication / sessions, authorization and tenant isolation (IDOR), realtime, rate limiting, CSP / XSS, data leaks through logs / Sentry / metrics, secrets in git history.

Out of scope: vulnerabilities in third-party libraries with no demonstrated exploit through TaskFlow (report upstream), missing "best practice" headers without a concrete exploit, physical attacks, social engineering. Features deliberately absent from v1 (e.g. email verification — ADR-049) are accepted risks, not vulnerabilities.

## Supported versions

Only the latest `main` branch.
