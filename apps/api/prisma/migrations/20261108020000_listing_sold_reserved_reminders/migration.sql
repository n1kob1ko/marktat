-- Verkauft/Reserviert und Ablauf-Erinnerungen für Inserate
ALTER TYPE "ListingStatus" ADD VALUE 'SOLD';

ALTER TABLE "listings" ADD COLUMN "reserved_at" TIMESTAMP(3);
ALTER TABLE "listings" ADD COLUMN "sold_at" TIMESTAMP(3);
ALTER TABLE "listings" ADD COLUMN "expiry_reminder_at" TIMESTAMP(3);
ALTER TABLE "listings" ADD COLUMN "expired_notice_at" TIMESTAMP(3);

ALTER TABLE "users" ADD COLUMN "notify_listings_by_email" BOOLEAN NOT NULL DEFAULT true;
