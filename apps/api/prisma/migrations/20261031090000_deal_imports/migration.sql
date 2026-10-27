-- CreateEnum
CREATE TYPE "DealImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DealFeedFormat" AS ENUM ('CSV', 'JSON');

-- CreateEnum
CREATE TYPE "DealFeedStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'FAILING');

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "feed_id" TEXT,
ADD COLUMN     "last_import_id" TEXT;

-- CreateTable
CREATE TABLE "deal_imports" (
    "id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "feed_id" TEXT,
    "source" "DealSource" NOT NULL,
    "format" "DealFeedFormat" NOT NULL DEFAULT 'CSV',
    "file_name" VARCHAR(200),
    "status" "DealImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "raw_text" TEXT,
    "headers" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "counts" JSONB NOT NULL DEFAULT '{}',
    "has_reference_prices" BOOLEAN NOT NULL DEFAULT false,
    "publish" BOOLEAN,
    "error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "deal_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_feeds" (
    "id" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "format" "DealFeedFormat" NOT NULL,
    "interval_hours" INTEGER NOT NULL,
    "license_note" VARCHAR(500) NOT NULL,
    "license_confirmed_at" TIMESTAMP(3) NOT NULL,
    "reference_prices_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "image_rights" "DealImageRights",
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "status" "DealFeedStatus" NOT NULL DEFAULT 'PENDING',
    "review_note" VARCHAR(500),
    "reviewed_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "etag" VARCHAR(200),
    "last_modified" VARCHAR(100),
    "last_fetched_at" TIMESTAMP(3),
    "next_fetch_at" TIMESTAMP(3),
    "last_error" VARCHAR(500),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "deal_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_imports_merchant_id_created_at_idx" ON "deal_imports"("merchant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deal_imports_status_expires_at_idx" ON "deal_imports"("status", "expires_at");

-- CreateIndex
CREATE INDEX "deal_imports_feed_id_created_at_idx" ON "deal_imports"("feed_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deal_feeds_status_next_fetch_at_idx" ON "deal_feeds"("status", "next_fetch_at");

-- CreateIndex
CREATE INDEX "deal_feeds_merchant_id_idx" ON "deal_feeds"("merchant_id");

-- CreateIndex
CREATE INDEX "deals_feed_id_idx" ON "deals"("feed_id");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "deal_feeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_imports" ADD CONSTRAINT "deal_imports_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_imports" ADD CONSTRAINT "deal_imports_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "deal_feeds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_feeds" ADD CONSTRAINT "deal_feeds_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
