-- Phase 10, Schritt 4: Projektaufträge. Nur neue Tabellen, Spalten, Enum-Werte und Constraints; bestehende Daten bleiben unverändert.

-- CreateEnum
CREATE TYPE "ServiceProjectStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'PENDING_REVIEW', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "ProjectBudgetType" AS ENUM ('FIXED', 'HOURLY', 'OPEN');

-- AlterEnum
ALTER TYPE "ModerationAction" ADD VALUE 'PROJECT_REJECTED';
ALTER TYPE "ModerationAction" ADD VALUE 'PROJECT_HIDDEN';
ALTER TYPE "ModerationAction" ADD VALUE 'PROJECT_RESTORED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_HIDDEN';
ALTER TYPE "NotificationType" ADD VALUE 'PROJECT_RESTORED';

-- AlterEnum
ALTER TYPE "ReportTarget" ADD VALUE 'PROJECT';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "project_id" TEXT;

-- AlterTable
ALTER TABLE "moderation_decisions" ADD COLUMN     "project_id" TEXT;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "project_id" TEXT;

-- CreateTable
CREATE TABLE "service_projects" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ServiceProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "category_id" TEXT NOT NULL,
    "location_id" INTEGER,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "budget_type" "ProjectBudgetType" NOT NULL DEFAULT 'OPEN',
    "budget_cents" INTEGER,
    "timeframe" VARCHAR(160),
    "expires_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "review_reason" VARCHAR(300),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_projects_status_expires_at_idx" ON "service_projects"("status", "expires_at");

-- CreateIndex
CREATE INDEX "service_projects_user_id_status_idx" ON "service_projects"("user_id", "status");

-- CreateIndex
CREATE INDEX "service_projects_category_id_idx" ON "service_projects"("category_id");

-- CreateIndex
CREATE INDEX "service_projects_location_id_idx" ON "service_projects"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_project_id_buyer_id_key" ON "conversations"("project_id", "buyer_id");

-- CreateIndex
CREATE INDEX "moderation_decisions_project_id_created_at_idx" ON "moderation_decisions"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reports_project_id_status_idx" ON "reports"("project_id", "status");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_decisions" ADD CONSTRAINT "moderation_decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "service_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_projects" ADD CONSTRAINT "service_projects_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Eine Unterhaltung hat genau einen Gegenstand: Inserat, Anbieterprofil oder Projektauftrag
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_subject_check";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_subject_check" CHECK (num_nonnulls("listing_id", "service_profile_id", "project_id") = 1);
