/*
  Warnings:

  - You are about to drop the column `url` on the `listing_images` table. All the data in the column will be lost.
  - Added the required column `declared_size` to the `listing_images` table without a default value. This is not possible if the table is not empty.
  - Added the required column `declared_type` to the `listing_images` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `listing_images` table without a default value. This is not possible if the table is not empty.

  Phase 1 hatte keinen Bild-Upload, die Tabelle ist in allen Umgebungen leer.
*/
-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('PENDING', 'READY');

-- DropIndex
DROP INDEX "listing_images_listing_id_sort_order_idx";

-- AlterTable
ALTER TABLE "listing_images" DROP COLUMN "url",
ADD COLUMN     "declared_size" INTEGER NOT NULL,
ADD COLUMN     "declared_type" TEXT NOT NULL,
ADD COLUMN     "detected_type" TEXT,
ADD COLUMN     "processed_at" TIMESTAMP(3),
ADD COLUMN     "status" "ImageStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "stored_bytes" INTEGER,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "upload_key" TEXT;

-- CreateIndex
CREATE INDEX "listing_images_listing_id_status_sort_order_idx" ON "listing_images"("listing_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "listing_images_status_created_at_idx" ON "listing_images"("status", "created_at");
