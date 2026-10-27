-- AlterEnum
ALTER TYPE "ServiceProfileStatus" ADD VALUE 'DELETED';

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_listing_id_fkey";

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_service_profile_id_fkey";

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_service_profile_id_fkey" FOREIGN KEY ("service_profile_id") REFERENCES "service_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
