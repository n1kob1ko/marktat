-- Preisvergleich: Angebote mit gleicher GTIN/EAN schnell finden
CREATE INDEX "deals_gtin_idx" ON "deals"("gtin");
