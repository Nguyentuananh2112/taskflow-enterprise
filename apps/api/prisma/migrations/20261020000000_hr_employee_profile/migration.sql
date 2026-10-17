-- Mốc 5 (T-054, hr-extended.md ADR-128): hồ sơ nhân viên tối giản. Timestamp thư mục là tạm — TL đặt lại lúc merge
-- (company-level §8.6). Không cột workspace_id / company_id (ADR-133); không FK tới company_members (bị xóa khi nghỉ).

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROFILE_UPDATED';

-- CreateTable
CREATE TABLE "employee_profiles" (
    "user_id" UUID NOT NULL,
    "hire_date" DATE,
    "department" VARCHAR(100),
    "job_title" VARCHAR(100),
    "work_phone" VARCHAR(16),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "employee_profiles_updated_by_id_idx" ON "employee_profiles"("updated_by_id");

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- CHECK (SQL tay — hr-extended §3)
-- Cận trên của hire_date (hôm nay theo giờ nghiệp vụ) kiểm ở app: CHECK không được dùng now().
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_hire_date_chk"
  CHECK ("hire_date" IS NULL OR "hire_date" >= DATE '1950-01-01');
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_department_chk"
  CHECK ("department" IS NULL OR btrim("department") <> '');
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_job_title_chk"
  CHECK ("job_title" IS NULL OR btrim("job_title") <> '');
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_work_phone_chk"
  CHECK ("work_phone" IS NULL OR "work_phone" ~ '^\+?[0-9]{8,15}$');
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_version_chk" CHECK ("version" >= 1);
