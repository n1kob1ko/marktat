-- Phase 10: Deals & Angebote (Händlerangebote, Filialen, Preisaufzeichnung) und Meldungen/Entscheidungen zu Deals.
-- Nur Ergänzungen: neue Tabellen, Enum-Werte und optionale Spalten – bestehende Daten bleiben unverändert.

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED', 'PENDING_REVIEW', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "DealChannel" AS ENUM ('ONLINE', 'LOCAL', 'BOTH');

-- CreateEnum
CREATE TYPE "ReferencePriceType" AS ENUM ('LOWEST_30_DAYS', 'RRP', 'MARKET_CHECK');

-- CreateEnum
CREATE TYPE "DealAvailability" AS ENUM ('UNKNOWN', 'IN_STOCK', 'LIMITED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "DealImageRights" AS ENUM ('OWN', 'MANUFACTURER', 'LICENSED');

-- CreateEnum
CREATE TYPE "DealSource" AS ENUM ('MANUAL', 'CSV', 'FEED');

-- CreateEnum
CREATE TYPE "DealLinkStatus" AS ENUM ('UNCHECKED', 'OK', 'BROKEN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationAction" ADD VALUE 'DEAL_REJECTED';
ALTER TYPE "ModerationAction" ADD VALUE 'DEAL_HIDDEN';
ALTER TYPE "ModerationAction" ADD VALUE 'DEAL_RESTORED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'DEAL_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'DEAL_HIDDEN';
ALTER TYPE "NotificationType" ADD VALUE 'DEAL_RESTORED';

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'DEAL';

-- AlterTable
ALTER TABLE "moderation_decisions" ADD COLUMN     "deal_id" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "deal_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dealer_certified_at" TIMESTAMP(3),
ADD COLUMN     "deals_blocked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "deal_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "related_category_path" TEXT,

    CONSTRAINT "deal_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "category_id" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(3000) NOT NULL DEFAULT '',
    "brand" VARCHAR(60),
    "gtin" VARCHAR(14),
    "external_id" VARCHAR(100),
    "channel" "DealChannel" NOT NULL,
    "url" VARCHAR(500),
    "is_affiliate_link" BOOLEAN NOT NULL DEFAULT false,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "unit_price_text" VARCHAR(40),
    "shipping_note" VARCHAR(120),
    "reference_price_cents" INTEGER,
    "reference_price_type" "ReferencePriceType",
    "reference_price_source" VARCHAR(200),
    "reference_price_evidence_url" VARCHAR(500),
    "reference_confirmed_at" TIMESTAMP(3),
    "discount_percent" INTEGER,
    "availability" "DealAvailability" NOT NULL DEFAULT 'UNKNOWN',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "review_reason" VARCHAR(200),
    "image_key" TEXT,
    "image_width" INTEGER,
    "image_height" INTEGER,
    "image_rights" "DealImageRights",
    "image_credit" VARCHAR(120),
    "source" "DealSource" NOT NULL DEFAULT 'MANUAL',
    "content_hash" VARCHAR(64),
    "link_status" "DealLinkStatus" NOT NULL DEFAULT 'UNCHECKED',
    "link_checked_at" TIMESTAMP(3),
    "link_failures" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "client_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_stores" (
    "id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "street" VARCHAR(200) NOT NULL,
    "location_id" INTEGER NOT NULL,
    "opening_hours" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dealer_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_stores" (
    "deal_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,

    CONSTRAINT "deal_stores_pkey" PRIMARY KEY ("deal_id","store_id")
);

-- CreateTable
CREATE TABLE "deal_price_records" (
    "id" BIGSERIAL NOT NULL,
    "deal_id" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "reference_price_cents" INTEGER,
    "source" "DealSource" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_price_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_categories_slug_key" ON "deal_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "deal_categories_name_key" ON "deal_categories"("name");

-- CreateIndex
CREATE INDEX "deals_status_ends_at_idx" ON "deals"("status", "ends_at");

-- CreateIndex
CREATE INDEX "deals_status_published_at_idx" ON "deals"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "deals_merchant_id_status_idx" ON "deals"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "deals_category_id_status_idx" ON "deals"("category_id", "status");

-- CreateIndex
CREATE INDEX "deals_last_verified_at_idx" ON "deals"("last_verified_at");

-- CreateIndex
CREATE INDEX "deals_link_checked_at_idx" ON "deals"("link_checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "deals_merchant_id_external_id_key" ON "deals"("merchant_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_merchant_id_client_request_id_key" ON "deals"("merchant_id", "client_request_id");

-- CreateIndex
CREATE INDEX "dealer_stores_merchant_id_idx" ON "dealer_stores"("merchant_id");

-- CreateIndex
CREATE INDEX "dealer_stores_location_id_idx" ON "dealer_stores"("location_id");

-- CreateIndex
CREATE INDEX "deal_stores_store_id_idx" ON "deal_stores"("store_id");

-- CreateIndex
CREATE INDEX "deal_price_records_deal_id_recorded_at_idx" ON "deal_price_records"("deal_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "moderation_decisions_deal_id_created_at_idx" ON "moderation_decisions"("deal_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_deal_id_status_idx" ON "reports"("deal_id", "status");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "deal_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_stores" ADD CONSTRAINT "dealer_stores_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_stores" ADD CONSTRAINT "dealer_stores_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stores" ADD CONSTRAINT "deal_stores_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_stores" ADD CONSTRAINT "deal_stores_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "dealer_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_price_records" ADD CONSTRAINT "deal_price_records_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

