-- Mốc 5 — migration 9 `hr_leave_policy` (T-057, hr-extended.md ADR-131 + §3). Timestamp thư mục là TẠM: TL đặt
-- lại ngay trước khi merge theo thứ tự 6 (T-054) · 7 (T-048) · 8 (T-055) · 9 (bản này).
-- Đổi nghĩa cột đi CÙNG PR với code đọc cột (B): `leave_balances.entitled_days` NULL = theo chính sách năm.

-- AlterTable
ALTER TABLE "leave_balances" ADD COLUMN     "carried_over_days" DECIMAL(4,1),
ALTER COLUMN "entitled_days" DROP NOT NULL,
ALTER COLUMN "entitled_days" DROP DEFAULT;

-- CreateTable
CREATE TABLE "leave_policies" (
    "year" INTEGER NOT NULL,
    "annual_days" DECIMAL(4,1) NOT NULL DEFAULT 12,
    "seniority_step_years" INTEGER NOT NULL DEFAULT 5,
    "seniority_bonus_days" DECIMAL(3,1) NOT NULL DEFAULT 1,
    "carry_over_enabled" BOOLEAN NOT NULL DEFAULT false,
    "carry_over_max_days" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "carry_over_expiry_month" INTEGER NOT NULL DEFAULT 3,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE INDEX "leave_policies_updated_by_id_idx" ON "leave_policies"("updated_by_id");

-- AddForeignKey
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- CHECK (SQL tay — §3)

-- Không thấp hơn mức luật (Đ.113 k.1: 12 ngày; Đ.114: +1 ngày mỗi ≤ 5 năm); bội 0,5 cho mọi cột thập phân.
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_year_chk" CHECK ("year" BETWEEN 2000 AND 2100);
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_annual_chk"
  CHECK ("annual_days" BETWEEN 12 AND 30 AND "annual_days" * 2 = trunc("annual_days" * 2));
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_step_chk" CHECK ("seniority_step_years" BETWEEN 1 AND 5);
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_bonus_chk"
  CHECK ("seniority_bonus_days" BETWEEN 1 AND 5 AND "seniority_bonus_days" * 2 = trunc("seniority_bonus_days" * 2));
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_carry_max_chk"
  CHECK ("carry_over_max_days" BETWEEN 0 AND 30 AND "carry_over_max_days" * 2 = trunc("carry_over_max_days" * 2));
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_expiry_month_chk"
  CHECK ("carry_over_expiry_month" BETWEEN 1 AND 12);
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_version_chk" CHECK ("version" >= 1);

-- `leave_balances_entitled_chk` (migration 3: entitled_days >= 0) vẫn đúng với NULL (CHECK NULL ⇒ qua). Thêm bội 0,5.
ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_entitled_chk";
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_entitled_chk"
  CHECK ("entitled_days" IS NULL OR ("entitled_days" >= 0 AND "entitled_days" * 2 = trunc("entitled_days" * 2)));
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_carried_chk"
  CHECK ("carried_over_days" IS NULL OR ("carried_over_days" >= 0 AND "carried_over_days" * 2 = trunc("carried_over_days" * 2)));

-- ---------------------------------------------------------------- đổi nghĩa dữ liệu cũ (D-H4)
-- Năm hiện tại trở đi: 12 (mặc định cũ) ⇒ NULL = theo chính sách. Năm đã qua giữ 12 làm ghi đè (số liệu năm cũ không
-- đổi). "Năm hiện tại" = giờ thật lúc deploy theo Asia/Ho_Chi_Minh (SQL không đọc được giờ nghiệp vụ). Mốc 3.5 đã tạo
-- lại `leave_balances` rỗng ⇒ câu này chủ yếu cho DB nào đã có dòng sau đó.
UPDATE "leave_balances" SET "entitled_days" = NULL
 WHERE "entitled_days" = 12
   AND "year" >= EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh');

DO $$
DECLARE kept integer;
BEGIN
  SELECT count(*) INTO kept FROM "leave_balances" WHERE "entitled_days" IS NOT NULL AND "entitled_days" <> 12;
  RAISE NOTICE 'hr_leave_policy: % dòng số dư có entitled_days khác 12 (giữ làm ghi đè)', kept;
END $$;
