# Công cụ sao lưu / diễn tập khôi phục (B2, ADR-074, devops.md §4.3–4.4).
# Client pg_dump / pg_restore CÙNG major với server (18) — lấy thẳng từ image Postgres đang dùng.
# age (mã hóa phía client) + aws CLI (giao diện S3 tương thích: R2, B2, Wasabi, MinIO…).
FROM postgres:18.6-bookworm

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
