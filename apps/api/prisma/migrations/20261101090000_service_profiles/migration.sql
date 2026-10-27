-- CreateEnum
CREATE TYPE "ServiceProfileStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "ServicePriceType" AS ENUM ('HOURLY', 'FIXED', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "ServiceAvailability" AS ENUM ('AVAILABLE', 'LIMITED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "PortfolioImageRights" AS ENUM ('OWN', 'CLIENT_PERMISSION', 'LICENSED');

-- CreateEnum
CREATE TYPE "QualificationStatus" AS ENUM ('CLAIMED', 'VERIFIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationAction" ADD VALUE 'SERVICE_PROFILE_REJECTED';
ALTER TYPE "ModerationAction" ADD VALUE 'SERVICE_PROFILE_HIDDEN';
ALTER TYPE "ModerationAction" ADD VALUE 'SERVICE_PROFILE_RESTORED';
ALTER TYPE "ModerationAction" ADD VALUE 'PORTFOLIO_ITEM_HIDDEN';
ALTER TYPE "ModerationAction" ADD VALUE 'PORTFOLIO_ITEM_RESTORED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_PROFILE_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_PROFILE_HIDDEN';
ALTER TYPE "NotificationType" ADD VALUE 'SERVICE_PROFILE_RESTORED';
ALTER TYPE "NotificationType" ADD VALUE 'PORTFOLIO_ITEM_HIDDEN';
ALTER TYPE "NotificationType" ADD VALUE 'PORTFOLIO_ITEM_RESTORED';

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'SERVICE_PROFILE';

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_listing_id_fkey";

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "service_profile_id" TEXT,
ALTER COLUMN "listing_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "moderation_decisions" ADD COLUMN     "service_profile_id" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "service_profile_id" TEXT;

-- CreateTable
CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group_slug" TEXT NOT NULL,
    "group_name" TEXT NOT NULL,
    "regulated" BOOLEAN NOT NULL DEFAULT false,
    "related_category_path" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_profiles" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ServiceProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "headline" VARCHAR(120) NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "location_id" INTEGER,
    "service_radius_km" INTEGER,
    "austria_wide" BOOLEAN NOT NULL DEFAULT false,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "price_type" "ServicePriceType" NOT NULL DEFAULT 'ON_REQUEST',
    "price_cents" INTEGER,
    "experience_years" INTEGER,
    "website" VARCHAR(300),
    "availability" "ServiceAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "availability_note" VARCHAR(160),
    "image_key" TEXT,
    "image_rights" "PortfolioImageRights",
    "image_credit" VARCHAR(120),
    "review_reason" VARCHAR(300),
    "confirmed_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_profile_categories" (
    "profile_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "service_profile_categories_pkey" PRIMARY KEY ("profile_id","category_id")
);

-- CreateTable
CREATE TABLE "service_portfolio_items" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "category_id" TEXT,
    "url" VARCHAR(500),
    "image_key" TEXT,
    "image_rights" "PortfolioImageRights",
    "image_credit" VARCHAR(120),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_qualifications" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "issuer" VARCHAR(120),
    "reference" VARCHAR(120),
    "status" "QualificationStatus" NOT NULL DEFAULT 'CLAIMED',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");

-- CreateIndex
CREATE INDEX "service_categories_group_slug_sort_order_idx" ON "service_categories"("group_slug", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "service_profiles_user_id_key" ON "service_profiles"("user_id");

-- CreateIndex
CREATE INDEX "service_profiles_status_updated_at_idx" ON "service_profiles"("status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "service_profiles_location_id_idx" ON "service_profiles"("location_id");

-- CreateIndex
CREATE INDEX "service_profile_categories_category_id_idx" ON "service_profile_categories"("category_id");

-- CreateIndex
CREATE INDEX "service_portfolio_items_profile_id_sort_order_idx" ON "service_portfolio_items"("profile_id", "sort_order");

-- CreateIndex
CREATE INDEX "service_qualifications_profile_id_idx" ON "service_qualifications"("profile_id");

-- CreateIndex
CREATE INDEX "service_qualifications_status_idx" ON "service_qualifications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_service_profile_id_buyer_id_key" ON "conversations"("service_profile_id", "buyer_id");

-- CreateIndex
CREATE INDEX "moderation_decisions_service_profile_id_created_at_idx" ON "moderation_decisions"("service_profile_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_service_profile_id_status_idx" ON "reports"("service_profile_id", "status");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_service_profile_id_fkey" FOREIGN KEY ("service_profile_id") REFERENCES "service_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_service_profile_id_fkey" FOREIGN KEY ("service_profile_id") REFERENCES "service_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_service_profile_id_fkey" FOREIGN KEY ("service_profile_id") REFERENCES "service_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_profiles" ADD CONSTRAINT "service_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_profiles" ADD CONSTRAINT "service_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_profile_categories" ADD CONSTRAINT "service_profile_categories_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "service_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_profile_categories" ADD CONSTRAINT "service_profile_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_portfolio_items" ADD CONSTRAINT "service_portfolio_items_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "service_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_portfolio_items" ADD CONSTRAINT "service_portfolio_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_qualifications" ADD CONSTRAINT "service_qualifications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "service_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Jede Unterhaltung betrifft genau ein Inserat oder ein Anbieterprofil (bestehende Unterhaltungen haben alle ein Inserat)
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_subject_check" CHECK (num_nonnulls("listing_id", "service_profile_id") = 1);
