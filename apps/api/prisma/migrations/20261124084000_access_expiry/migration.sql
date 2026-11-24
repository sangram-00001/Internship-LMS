BEGIN;
-- AlterTable
ALTER TABLE "DirectEnrollment" ADD COLUMN     "expiresAt" TIMESTAMP(3);

COMMIT;
