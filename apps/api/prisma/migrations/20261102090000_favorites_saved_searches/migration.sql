-- Phase 10, Schritt 5: Merkliste für Deals und Anbieterprofile, gespeicherte Suchen für Deals und Anbieter.
-- Rückwärtskompatibel: nur neue Tabellen und eine Spalte mit Standardwert; bestehende Suchen gelten als LISTINGS.
-- CreateEnum
CREATE TYPE "SavedSearchKind" AS ENUM ('LISTINGS', 'DEALS', 'SERVICES');

-- AlterTable
ALTER TABLE "saved_searches" ADD COLUMN     "kind" "SavedSearchKind" NOT NULL DEFAULT 'LISTINGS';

-- CreateTable
CREATE TABLE "deal_favorites" (
    "user_id" UUID NOT NULL,
    "deal_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_favorites_pkey" PRIMARY KEY ("user_id","deal_id")
);

-- CreateTable
CREATE TABLE "service_favorites" (
    "user_id" UUID NOT NULL,
    "profile_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_favorites_pkey" PRIMARY KEY ("user_id","profile_id")
);

-- CreateIndex
CREATE INDEX "deal_favorites_user_id_created_at_idx" ON "deal_favorites"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deal_favorites_deal_id_idx" ON "deal_favorites"("deal_id");

-- CreateIndex
CREATE INDEX "service_favorites_user_id_created_at_idx" ON "service_favorites"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "service_favorites_profile_id_idx" ON "service_favorites"("profile_id");

-- CreateIndex (erst der neue eindeutige Index, dann der alte weg – bestehende Suchen bleiben eindeutig)
CREATE UNIQUE INDEX "saved_searches_user_id_kind_query_key_key" ON "saved_searches"("user_id", "kind", "query_key");

-- DropIndex
DROP INDEX "saved_searches_user_id_query_key_key";

-- AddForeignKey
ALTER TABLE "deal_favorites" ADD CONSTRAINT "deal_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_favorites" ADD CONSTRAINT "deal_favorites_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_favorites" ADD CONSTRAINT "service_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_favorites" ADD CONSTRAINT "service_favorites_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "service_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
