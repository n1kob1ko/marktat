-- Kategorie laut Partnerfeed (Kontrolle der automatischen Zuordnung)
ALTER TABLE "deals" ADD COLUMN "source_category" VARCHAR(200);
