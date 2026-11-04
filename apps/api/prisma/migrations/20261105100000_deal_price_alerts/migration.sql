-- Preisalarm für gemerkte Deals
ALTER TABLE "deal_favorites" ADD COLUMN "price_alert" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "deal_favorites" ADD COLUMN "alert_price_cents" INTEGER;
ALTER TABLE "deal_favorites" ADD COLUMN "alert_notified_at" TIMESTAMP(3);
