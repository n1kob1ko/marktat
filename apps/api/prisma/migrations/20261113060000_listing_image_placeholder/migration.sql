-- Winziges, unscharfes Vorschaubild (Daten-URL) als Platzhalter, bis das Foto geladen ist
ALTER TABLE "listing_images" ADD COLUMN "placeholder" TEXT;
