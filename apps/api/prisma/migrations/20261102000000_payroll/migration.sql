-- Mốc 4 (T-048, payroll.md v4 §3, ADR-124…127): phiếu lương cấp công ty. Chạy SAU Mốc 5 (…_hr_leave_policy) và Mốc 6
-- (…_avatar, …_chat — vào main trước, TL 18/10). Không cột workspace_id / company_id (ADR-133).
-- Tiền BIGINT đồng, ≤ 1e12 mỗi ô; công là số nguyên NỬA ngày (0..62). Bảng ở đây NGOÀI mọi bước retention (RD-11).

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PayslipSection" AS ENUM ('INCOME', 'BONUS', 'DEDUCTION');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYSLIP_PUBLISHED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYSLIP_REVISED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYROLL_REMINDER';

-- CreateTable
CREATE TABLE "payroll_settings" (
    "id" SMALLINT NOT NULL,
    "seniority_per_year" BIGINT NOT NULL DEFAULT 500000,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "effective_from" CHAR(7) NOT NULL,
    "level" VARCHAR(32) NOT NULL,
    "base_salary" BIGINT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "period" CHAR(7) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "standard_days" SMALLINT NOT NULL,
    "seniority_per_year" BIGINT NOT NULL,
    "company_name" VARCHAR(100),
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lock_version" INTEGER NOT NULL DEFAULT 1,
    "full_name" VARCHAR(100) NOT NULL,
    "level" VARCHAR(32),
    "base_salary" BIGINT,
    "hire_date" DATE,
    "seniority_years" SMALLINT NOT NULL DEFAULT 0,
    "seniority_allowance" BIGINT NOT NULL DEFAULT 0,
    "paid_half_days" SMALLINT NOT NULL,
    "override_half_days" SMALLINT,
    "override_reason" VARCHAR(500),
    "revision_reason" VARCHAR(500),
    "salary_by_days" BIGINT NOT NULL,
    "income_total" BIGINT NOT NULL,
    "bonus_total" BIGINT NOT NULL,
    "deduction_total" BIGINT NOT NULL,
    "net_pay" BIGINT NOT NULL,
    "note" VARCHAR(1000),
    "has_sick_days" BOOLEAN NOT NULL DEFAULT false,
    "superseded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_lines" (
    "id" UUID NOT NULL,
    "payslip_id" UUID NOT NULL,
    "section" "PayslipSection" NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "amount" BIGINT NOT NULL,
    "sort_order" SMALLINT NOT NULL,

    CONSTRAINT "payslip_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_settings_updated_by_id_idx" ON "payroll_settings"("updated_by_id");

-- CreateIndex
CREATE INDEX "salary_profiles_created_by_id_idx" ON "salary_profiles"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_profiles_user_id_effective_from_key" ON "salary_profiles"("user_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_period_key" ON "payroll_runs"("period");

-- CreateIndex
CREATE INDEX "payroll_runs_published_by_id_idx" ON "payroll_runs"("published_by_id");

-- CreateIndex
CREATE INDEX "payroll_runs_created_by_id_idx" ON "payroll_runs"("created_by_id");

-- CreateIndex
CREATE INDEX "payslips_user_id_idx" ON "payslips"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_user_id_revision_key" ON "payslips"("run_id", "user_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_current_key" ON "payslips"("run_id", "user_id") WHERE (superseded_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "payslip_lines_payslip_id_sort_order_key" ON "payslip_lines"("payslip_id", "sort_order");

-- AddForeignKey
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- CHECK (SQL tay — payroll.md §3)
-- payroll_settings: luôn MỘT dòng (SEC-PAY-12).
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_singleton_chk" CHECK ("id" = 1);
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_seniority_chk"
  CHECK ("seniority_per_year" BETWEEN 0 AND 1000000000000);
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_version_chk" CHECK ("version" >= 1);
INSERT INTO "payroll_settings" ("id", "seniority_per_year", "version", "updated_by_id", "updated_at")
  VALUES (1, 500000, 1, NULL, CURRENT_TIMESTAMP);

ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_period_chk"
  CHECK ("effective_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_level_chk" CHECK (btrim("level") <> '');
ALTER TABLE "salary_profiles" ADD CONSTRAINT "salary_profiles_base_chk"
  CHECK ("base_salary" BETWEEN 1 AND 1000000000000);

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_period_chk"
  CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_standard_days_chk" CHECK ("standard_days" BETWEEN 1 AND 31);
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_seniority_chk"
  CHECK ("seniority_per_year" BETWEEN 0 AND 1000000000000);
-- Phát hành ⇔ có người / giờ phát hành + tên công ty chụp lúc đó.
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_published_chk"
  CHECK (("status" = 'PUBLISHED') = ("published_at" IS NOT NULL AND "published_by_id" IS NOT NULL
                                     AND "company_name" IS NOT NULL));

ALTER TABLE "payslips" ADD CONSTRAINT "payslips_revision_chk" CHECK ("revision" >= 1 AND "lock_version" >= 1);
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_revision_reason_chk"
  CHECK ("revision" = 1 OR ("revision_reason" IS NOT NULL AND btrim("revision_reason") <> ''));
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_profile_chk"
  CHECK (("level" IS NULL) = ("base_salary" IS NULL)
         AND ("base_salary" IS NULL OR "base_salary" BETWEEN 1 AND 1000000000000));
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_seniority_chk"
  CHECK ("seniority_years" BETWEEN 0 AND 80 AND "seniority_allowance" BETWEEN 0 AND 80000000000000);
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_half_days_chk"
  CHECK ("paid_half_days" BETWEEN 0 AND 62
         AND ("override_half_days" IS NULL OR "override_half_days" BETWEEN 0 AND 62));
-- Sửa công ⇔ có lý do (contract PutPayslipBody).
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_override_chk"
  CHECK (("override_half_days" IS NULL) = ("override_reason" IS NULL)
         AND ("override_reason" IS NULL OR btrim("override_reason") <> ''));
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_totals_nonneg_chk"
  CHECK ("salary_by_days" >= 0 AND "income_total" >= 0 AND "bonus_total" >= 0 AND "deduction_total" >= 0);
-- Thực lĩnh = (1) + (2) − (3) — một hàm tính duy nhất (computePayslip), DB chốt đẳng thức.
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_net_pay_chk"
  CHECK ("net_pay" = "income_total" + "bonus_total" - "deduction_total");
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_note_chk" CHECK ("note" IS NULL OR btrim("note") <> '');

ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_label_chk" CHECK (btrim("label") <> '');
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_amount_chk" CHECK ("amount" BETWEEN 0 AND 1000000000000);
ALTER TABLE "payslip_lines" ADD CONSTRAINT "payslip_lines_sort_chk" CHECK ("sort_order" BETWEEN 0 AND 49);

-- ---------------------------------------------------------------- Bất biến sau phát hành (ADR-125, RD-05)
-- Lớp 2 sau use case: kể cả SQL thẳng cũng không sửa được số của bảng đã phát hành.
--  * payroll_runs PUBLISHED: không UPDATE (kể cả về DRAFT), không DELETE.
--  * payslips của bảng PUBLISHED: không DELETE; UPDATE chỉ được ĐẶT `superseded_at` (từ NULL) khi tạo bản điều chỉnh
--    (+ `updated_at`); INSERT (bản `revision + 1`) được.
--  * payslip_lines của phiếu thuộc bảng PUBLISHED: không UPDATE / DELETE; INSERT chỉ cho phiếu `revision > 1` còn hiệu lực
--    (dòng của bản điều chỉnh vừa tạo, cùng transaction).
CREATE FUNCTION payroll_run_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    RAISE EXCEPTION 'payroll_runs %: bảng lương đã phát hành là bất biến', OLD.period
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER payroll_runs_immutable BEFORE UPDATE OR DELETE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION payroll_run_immutable();

CREATE FUNCTION payslip_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE published boolean;
BEGIN
  SELECT r.status = 'PUBLISHED' INTO published FROM payroll_runs r WHERE r.id = OLD.run_id;
  IF NOT published THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payslips %: phiếu của bảng đã phát hành không xóa được', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_at' - 'updated_at') = (to_jsonb(OLD) - 'superseded_at' - 'updated_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payslips %: phiếu đã phát hành là bất biến (tạo bản điều chỉnh)', OLD.id
    USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER payslips_immutable BEFORE UPDATE OR DELETE ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION payslip_immutable();

CREATE FUNCTION payslip_line_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; published boolean; rev integer; superseded timestamptz;
BEGIN
  target := CASE WHEN TG_OP = 'INSERT' THEN NEW.payslip_id ELSE OLD.payslip_id END;
  SELECT r.status = 'PUBLISHED', p.revision, p.superseded_at INTO published, rev, superseded
    FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = target;
  IF NOT published OR (TG_OP = 'INSERT' AND rev > 1 AND superseded IS NULL) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'payslip_lines của phiếu %: phiếu đã phát hành là bất biến', target
    USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER payslip_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON "payslip_lines"
  FOR EACH ROW EXECUTE FUNCTION payslip_line_immutable();
