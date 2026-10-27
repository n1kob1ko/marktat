
-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('LISTING', 'CONVERSATION');

-- CreateEnum
CREATE TYPE "ReportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ReportEventType" AS ENUM ('CREATED', 'ASSIGNED', 'UNASSIGNED', 'PRIORITY_CHANGED', 'STATUS_CHANGED', 'NOTE');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('LISTING_REJECTED', 'LISTING_HIDDEN', 'LISTING_RESTORED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_RESTORED');

-- CreateEnum
CREATE TYPE "DecisionGround" AS ENUM ('TERMS', 'ILLEGAL');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('OPEN', 'UPHELD', 'REVERSED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LISTING_REJECTED', 'LISTING_HIDDEN', 'LISTING_RESTORED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_RESTORED', 'APPEAL_DECIDED', 'REPORT_HANDLED');

-- CreateEnum
CREATE TYPE "DeletionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReportReason" ADD VALUE 'PROHIBITED_ITEM';
ALTER TYPE "ReportReason" ADD VALUE 'MISLEADING';

-- AlterEnum
ALTER TYPE "ReportStatus" ADD VALUE 'IN_REVIEW';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "reporting_blocked_until" TIMESTAMP(3),
ADD COLUMN     "suspended_at" TIMESTAMP(3);

-- Meldungen: user_reports wird zu reports umbenannt (Daten bleiben erhalten) und um Inserate,
-- Bearbeitungsstand und Priorität erweitert.
ALTER TABLE "user_reports" RENAME TO "reports";
ALTER TABLE "reports" RENAME CONSTRAINT "user_reports_pkey" TO "reports_pkey";
ALTER INDEX "user_reports_status_created_at_idx" RENAME TO "reports_status_created_at_idx";
ALTER INDEX "user_reports_reported_id_idx" RENAME TO "reports_reported_id_idx";

-- Meldungen bleiben nachvollziehbar, auch wenn ein beteiligtes Konto gelöscht wird (Verweis wird null)
ALTER TABLE "reports" DROP CONSTRAINT "user_reports_reporter_id_fkey";
ALTER TABLE "reports" DROP CONSTRAINT "user_reports_reported_id_fkey";
ALTER TABLE "reports" DROP CONSTRAINT "user_reports_conversation_id_fkey";
ALTER TABLE "reports" ALTER COLUMN "reporter_id" DROP NOT NULL,
ALTER COLUMN "reported_id" DROP NOT NULL,
ADD COLUMN     "target_type" "ReportTarget" NOT NULL DEFAULT 'CONVERSATION',
ADD COLUMN     "listing_id" TEXT,
ADD COLUMN     "priority" "ReportPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "assignee_id" UUID,
ADD COLUMN     "abusive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "decision_id" TEXT,
ADD COLUMN     "resolution_note" VARCHAR(1000),
ADD COLUMN     "handled_by_id" UUID,
ADD COLUMN     "handled_at" TIMESTAMP(3),
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_fkey" FOREIGN KEY ("reported_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "report_events" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "actor_id" UUID,
    "type" "ReportEventType" NOT NULL,
    "from_status" "ReportStatus",
    "to_status" "ReportStatus",
    "note" VARCHAR(1000),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_decisions" (
    "id" TEXT NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "user_id" UUID NOT NULL,
    "listing_id" TEXT,
    "moderator_id" UUID,
    "reason" "ReportReason",
    "ground" "DecisionGround",
    "statement" VARCHAR(2000) NOT NULL,
    "internal_note" VARCHAR(1000),
    "snapshot" JSONB,
    "reverses_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" TEXT NOT NULL,
    "decision_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'OPEN',
    "reviewer_id" UUID,
    "response" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "link" VARCHAR(300),
    "decision_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletions" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DeletionStatus" NOT NULL DEFAULT 'PENDING',
    "completed_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_priority_created_at_idx" ON "reports"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "reports_listing_id_status_idx" ON "reports"("listing_id", "status");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_conversation_id_idx" ON "reports"("conversation_id");

-- CreateIndex
CREATE INDEX "report_events_report_id_created_at_idx" ON "report_events"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_decisions_user_id_created_at_idx" ON "moderation_decisions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moderation_decisions_listing_id_created_at_idx" ON "moderation_decisions"("listing_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "moderation_decisions_created_at_idx" ON "moderation_decisions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appeals_decision_id_key" ON "appeals"("decision_id");

-- CreateIndex
CREATE INDEX "appeals_status_created_at_idx" ON "appeals"("status", "created_at");

-- CreateIndex
CREATE INDEX "appeals_user_id_idx" ON "appeals"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletions_user_id_key" ON "account_deletions"("user_id");

-- CreateIndex
CREATE INDEX "account_deletions_status_updated_at_idx" ON "account_deletions"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "moderation_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "moderation_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ein Einspruch wird nie von der Person entschieden, die ihn erhoben hat
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_reviewer_not_author" CHECK ("reviewer_id" IS NULL OR "reviewer_id" <> "user_id");
