# Công cụ sao lưu / diễn tập khôi phục (B2, ADR-074, devops.md §4.3–4.4).
# Client pg_dump / pg_restore CÙNG major với server (18) — lấy thẳng từ image Postgres đang dùng.
# age (mã hóa phía client) + aws CLI (giao diện S3 tương thích: R2, B2, Wasabi, MinIO…).
FROM postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c

# age / awscli KHÔNG ghim phiên bản apt: image chỉ dùng cho diễn tập (dữ liệu giả) và job backup; base
# đã ghim digest nên Debian bookworm cố định, gói chỉ đổi khi có bản vá bảo mật — đó là điều muốn có.
RUN apt-get update \
  && apt-get install -y --no-install-recommends age awscli ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backup.sh restore-drill.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/restore-drill.sh

# Không chạy bằng root: script chỉ cần mạng + /tmp.
USER postgres
WORKDIR /tmp
ENTRYPOINT []
CMD ["backup.sh"]
