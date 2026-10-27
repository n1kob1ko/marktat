-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "municipality" TEXT;

-- CreateIndex
CREATE INDEX "locations_place_idx" ON "locations" USING GIN ("place" gin_trgm_ops);
