-- CreateEnum
CREATE TYPE "AffiliateNetwork" AS ENUM ('AWIN');

-- CreateEnum
CREATE TYPE "AffiliateProgramStatus" AS ENUM ('PENDING', 'APPROVED', 'PAUSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AffiliateMembership" AS ENUM ('JOINED', 'NOT_JOINED', 'PENDING', 'SUSPENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AffiliateFeedStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'FAILING', 'REMOVED');

-- CreateEnum
CREATE TYPE "AffiliateSyncKind" AS ENUM ('FEED_LIST', 'FEED', 'PROMOTIONS');

-- CreateEnum
CREATE TYPE "AffiliateSyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "AffiliatePromotionType" AS ENUM ('PROMOTION', 'VOUCHER');



-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "affiliate_feed_id" TEXT,
ADD COLUMN     "affiliate_program_id" TEXT,
ADD COLUMN     "external_image_url" VARCHAR(1000),
ALTER COLUMN "merchant_id" DROP NOT NULL,
ALTER COLUMN "url" SET DATA TYPE VARCHAR(1000);

-- CreateTable
CREATE TABLE "affiliate_programs" (
    "id" TEXT NOT NULL,
    "network" "AffiliateNetwork" NOT NULL,
    "external_id" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "region" VARCHAR(10),
    "membership" "AffiliateMembership" NOT NULL DEFAULT 'UNKNOWN',
    "membership_checked_at" TIMESTAMP(3),
    "status" "AffiliateProgramStatus" NOT NULL DEFAULT 'PENDING',
    "approval_note" VARCHAR(1000),
    "reviewed_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "allow_images" BOOLEAN NOT NULL DEFAULT false,
    "allow_reference_prices" BOOLEAN NOT NULL DEFAULT false,
    "allow_vouchers" BOOLEAN NOT NULL DEFAULT false,
    "default_category_id" TEXT,
    "last_sync_at" TIMESTAMP(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_feeds" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "external_id" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "language" VARCHAR(10),
    "vertical" VARCHAR(60),
    "status" "AffiliateFeedStatus" NOT NULL DEFAULT 'PENDING',
    "approval_note" VARCHAR(1000),
    "reviewed_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "network_updated_at" TIMESTAMP(3),
    "processed_updated_at" TIMESTAMP(3),
    "listed_at" TIMESTAMP(3),
    "last_fetched_at" TIMESTAMP(3),
    "next_fetch_at" TIMESTAMP(3),
    "last_error" VARCHAR(500),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "product_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_sync_runs" (
    "id" TEXT NOT NULL,
    "network" "AffiliateNetwork" NOT NULL,
    "kind" "AffiliateSyncKind" NOT NULL,
    "status" "AffiliateSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "program_id" TEXT,
    "feed_id" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" VARCHAR(1000),
    "triggered_by_id" UUID,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "affiliate_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_promotions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "external_id" VARCHAR(40) NOT NULL,
    "type" "AffiliatePromotionType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "terms" VARCHAR(2000),
    "voucher_code" VARCHAR(80),
    "url" VARCHAR(1000) NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_programs_status_idx" ON "affiliate_programs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_programs_network_external_id_key" ON "affiliate_programs"("network", "external_id");

-- CreateIndex
CREATE INDEX "affiliate_feeds_status_next_fetch_at_idx" ON "affiliate_feeds"("status", "next_fetch_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_feeds_program_id_external_id_key" ON "affiliate_feeds"("program_id", "external_id");

-- CreateIndex
CREATE INDEX "affiliate_sync_runs_started_at_idx" ON "affiliate_sync_runs"("started_at" DESC);

-- CreateIndex
CREATE INDEX "affiliate_sync_runs_kind_status_started_at_idx" ON "affiliate_sync_runs"("kind", "status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "affiliate_sync_runs_feed_id_started_at_idx" ON "affiliate_sync_runs"("feed_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "affiliate_promotions_hidden_at_ends_at_idx" ON "affiliate_promotions"("hidden_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_promotions_program_id_external_id_key" ON "affiliate_promotions"("program_id", "external_id");

-- CreateIndex
CREATE INDEX "deals_affiliate_feed_id_idx" ON "deals"("affiliate_feed_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_affiliate_program_id_external_id_key" ON "deals"("affiliate_program_id", "external_id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_affiliate_program_id_fkey" FOREIGN KEY ("affiliate_program_id") REFERENCES "affiliate_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_affiliate_feed_id_fkey" FOREIGN KEY ("affiliate_feed_id") REFERENCES "affiliate_feeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_programs" ADD CONSTRAINT "affiliate_programs_default_category_id_fkey" FOREIGN KEY ("default_category_id") REFERENCES "deal_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_feeds" ADD CONSTRAINT "affiliate_feeds_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "affiliate_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_sync_runs" ADD CONSTRAINT "affiliate_sync_runs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "affiliate_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_sync_runs" ADD CONSTRAINT "affiliate_sync_runs_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "affiliate_feeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_promotions" ADD CONSTRAINT "affiliate_promotions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "affiliate_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Strikte Trennung: Händlerdeals (MANUAL, CSV, FEED) gehören immer einem Händlerkonto, Affiliate-Deals nie –
-- sie gehören einem Partnerprogramm. So kann kein fremdes Angebot einem MarktAT-Händler zugeschrieben werden.
ALTER TABLE "deals" ADD CONSTRAINT "deals_owner_check" CHECK (
  (source = 'AFFILIATE' AND merchant_id IS NULL AND affiliate_program_id IS NOT NULL AND external_id IS NOT NULL AND feed_id IS NULL)
  OR (source <> 'AFFILIATE' AND merchant_id IS NOT NULL AND affiliate_program_id IS NULL AND affiliate_feed_id IS NULL AND external_image_url IS NULL)
);
