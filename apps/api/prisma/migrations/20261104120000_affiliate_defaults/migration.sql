-- Produktbilder und Vergleichspreise (UVP) sind ab jetzt standardmäßig erlaubt (Entscheidung des Betreibers, 04.11.2026).
-- Einzelne Programme lassen sich in /admin/affiliate weiterhin ausnehmen.
ALTER TABLE "affiliate_programs" ALTER COLUMN "allow_images" SET DEFAULT true;
ALTER TABLE "affiliate_programs" ALTER COLUMN "allow_reference_prices" SET DEFAULT true;
UPDATE "affiliate_programs" SET "allow_images" = true, "allow_reference_prices" = true;
