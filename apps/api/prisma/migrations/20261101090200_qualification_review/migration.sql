-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'QUALIFICATION_REVIEWED';

-- AddForeignKey
ALTER TABLE "service_qualifications" ADD CONSTRAINT "service_qualifications_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
