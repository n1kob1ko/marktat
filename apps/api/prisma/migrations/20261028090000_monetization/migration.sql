-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('LISTING', 'HIGHLIGHT', 'TOP_AD', 'BUMP');

-- CreateEnum
CREATE TYPE "BillingMode" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "bumped_at" TIMESTAMP(3),
ADD COLUMN     "highlight_paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "highlighted_until" TIMESTAMP(3),
ADD COLUMN     "top_paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "top_until" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "logo_key" TEXT,
ADD COLUMN     "show_phone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "website" VARCHAR(200);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "planned_price_cents" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "duration_days" INTEGER,
    "for_private" BOOLEAN NOT NULL DEFAULT true,
    "for_business" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "paid_enabled" BOOLEAN NOT NULL DEFAULT false,
    "promo_starts_at" TIMESTAMP(3),
    "promo_ends_at" TIMESTAMP(3),
    "max_active_per_user" INTEGER,
    "max_active_total" INTEGER,
    "max_per_period" INTEGER,
    "period_days" INTEGER NOT NULL DEFAULT 30,
    "cooldown_hours" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "billing_mode" "BillingMode" NOT NULL DEFAULT 'FREE',
    "billing_mode_changed_at" TIMESTAMP(3),
    "billing_mode_changed_by" UUID,
    "intro_enabled" BOOLEAN NOT NULL DEFAULT true,
    "intro_visible" BOOLEAN NOT NULL DEFAULT true,
    "intro_title" VARCHAR(80) NOT NULL DEFAULT 'Jetzt kostenlos inserieren',
    "intro_description" VARCHAR(400) NOT NULL DEFAULT 'Während unserer Einführungsphase kannst du deine Inserate kostenlos veröffentlichen.',
    "intro_starts_at" TIMESTAMP(3),
    "intro_ends_at" TIMESTAMP(3),
    "intro_show_planned_price" BOOLEAN NOT NULL DEFAULT false,
    "max_bookings_per_hour" INTEGER NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "user_id" UUID,
    "listing_id" TEXT,
    "product_id" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "billing_mode" "BillingMode" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "idempotency_key" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "user_id" UUID,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'stripe',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "checkout_session_id" TEXT,
    "payment_intent_id" TEXT,
    "failure_reason" VARCHAR(300),
    "receipt_url" VARCHAR(500),
    "invoice_number" VARCHAR(40),
    "paid_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_view_days" (
    "listing_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listing_view_days_pkey" PRIMARY KEY ("listing_id","day")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "bookings_listing_id_kind_status_idx" ON "bookings"("listing_id", "kind", "status");

-- CreateIndex
CREATE INDEX "bookings_status_ends_at_idx" ON "bookings"("status", "ends_at");

-- CreateIndex
CREATE INDEX "bookings_product_id_status_idx" ON "bookings"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_user_id_idempotency_key_key" ON "bookings"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_booking_id_key" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_checkout_session_id_key" ON "payments"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_payment_intent_id_key" ON "payments"("payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoice_number_key" ON "payments"("invoice_number");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "stripe_events_processed_at_idx" ON "stripe_events"("processed_at");

-- CreateIndex
CREATE INDEX "listings_top_until_idx" ON "listings"("top_until");

-- CreateIndex
CREATE INDEX "users_account_type_status_idx" ON "users"("account_type", "status");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_view_days" ADD CONSTRAINT "listing_view_days_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plausibilitätsregeln: keine negativen Beträge oder Limits, genau eine Einstellungszeile
ALTER TABLE "products" ADD CONSTRAINT "products_price_check" CHECK ("price_cents" >= 0 AND ("planned_price_cents" IS NULL OR "planned_price_cents" >= 0));
ALTER TABLE "products" ADD CONSTRAINT "products_limits_check" CHECK (
  ("duration_days" IS NULL OR "duration_days" > 0) AND "period_days" > 0
  AND ("max_active_per_user" IS NULL OR "max_active_per_user" >= 0)
  AND ("max_active_total" IS NULL OR "max_active_total" >= 0)
  AND ("max_per_period" IS NULL OR "max_per_period" >= 0)
  AND ("cooldown_hours" IS NULL OR "cooldown_hours" >= 0)
);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_check" CHECK ("price_cents" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_cents" >= 0 AND "refunded_cents" >= 0 AND "refunded_cents" <= "amount_cents");
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_singleton" CHECK ("id" = 1);

-- Startkonfiguration: kostenloser Betrieb, alle Leistungen 0,00 €. Die Limits sind Entwicklungsstandards
-- (docs/monetarisierung.md) und im Admin-Bereich änderbar. Bestehende Zeilen bleiben unverändert.
INSERT INTO "platform_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "products" ("id", "code", "kind", "name", "description", "duration_days", "max_active_per_user", "max_active_total", "max_per_period", "period_days", "cooldown_hours", "sort_order", "updated_at") VALUES
  ('prod_listing', 'listing', 'LISTING', 'Inserat', 'Ein Inserat veröffentlichen oder verlängern.', 60, NULL, NULL, NULL, 30, NULL, 0, CURRENT_TIMESTAMP),
  ('prod_highlight', 'highlight', 'HIGHLIGHT', 'Hervorhebung', 'Dein Inserat fällt in Suchergebnissen und Listen durch eine farbige Markierung auf.', 7, 5, NULL, 10, 30, NULL, 1, CURRENT_TIMESTAMP),
  ('prod_top', 'top', 'TOP_AD', 'Top-Anzeige', 'Dein Inserat erscheint abwechselnd mit anderen im Bereich „Top-Anzeigen“ über passenden Suchergebnissen.', 7, 2, 200, 4, 30, NULL, 2, CURRENT_TIMESTAMP),
  ('prod_bump', 'bump', 'BUMP', 'Hochschieben', 'Dein Inserat rückt in der Sortierung „Neueste“ wieder nach oben. Das Veröffentlichungsdatum bleibt gleich.', NULL, NULL, NULL, 30, 30, 24, 3, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
