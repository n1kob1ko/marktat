-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ModerationAction" ADD VALUE 'RATING_HIDDEN';
ALTER TYPE "ModerationAction" ADD VALUE 'RATING_RESTORED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'RATING_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE 'RATING_HIDDEN';
ALTER TYPE "NotificationType" ADD VALUE 'RATING_RESTORED';

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'RATING';

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "rating_id" TEXT;

-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "rater_id" UUID NOT NULL,
    "ratee_id" UUID NOT NULL,
    "stars" SMALLINT NOT NULL,
    "comment" VARCHAR(500),
    "reply" VARCHAR(500),
    "replied_at" TIMESTAMP(3),
    "hidden_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ratings_ratee_id_created_at_idx" ON "ratings"("ratee_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ratings_rater_id_created_at_idx" ON "ratings"("rater_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ratings_conversation_id_rater_id_key" ON "ratings"("conversation_id", "rater_id");

-- CreateIndex
CREATE INDEX "reports_rating_id_status_idx" ON "reports"("rating_id", "status");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_id_fkey" FOREIGN KEY ("ratee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_rating_id_fkey" FOREIGN KEY ("rating_id") REFERENCES "ratings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sterne nur 1–5 (zusätzlich zur Prüfung in der API)
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5);
