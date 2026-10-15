-- Cấp quyền DML cho user app SAU MỖI LẦN `prisma migrate deploy` (chạy bằng taskflow_migrator — owner schema).
-- Lý do: `ALTER DEFAULT PRIVILEGES … IN SCHEMA public` lưu THEO TỪNG DATABASE và gắn với schema ⇒ DB tạo sau
-- init (CREATE DATABASE), DB managed ở production, hay schema bị xóa/dựng lại đều KHÔNG có ⇒ app không đọc/ghi
-- được bảng mới. Chạy lại sau mỗi migrate làm mọi môi trường hội tụ về cùng một trạng thái (idempotent).
-- Gọi bởi: image migrate (docker/migrate/migrate.mjs), `pnpm --filter @taskflow/api db:deploy`, CI.
-- Quy ước tên role (devops.md §4.1): taskflow_app = chỉ DML; KHÔNG BAO GIỜ chạy app bằng taskflow_migrator.
DO $$
DECLARE
  db text := current_database();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'taskflow_app') THEN
    RAISE EXCEPTION 'Role taskflow_app không tồn tại — tạo role app (chỉ DML) trước khi migrate (devops.md §4.1)';
  END IF;
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO taskflow_app', db);
END $$;

GRANT USAGE ON SCHEMA public TO taskflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO taskflow_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO taskflow_app;
-- Bảng/sequence do migrator tạo về sau trong DB này tự có quyền (lần migrate kế tiếp cũng grant lại ở trên).
ALTER DEFAULT PRIVILEGES FOR ROLE taskflow_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO taskflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE taskflow_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO taskflow_app;
-- App không bao giờ có DDL: thu hồi CREATE trên schema nếu ai đó lỡ cấp (PUBLIC và app).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM taskflow_app;
