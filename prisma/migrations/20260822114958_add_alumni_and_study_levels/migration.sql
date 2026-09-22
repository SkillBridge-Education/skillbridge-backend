-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'ALUMNI';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "leftAt" TIMESTAMP(3),
ADD COLUMN     "studyLevel" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "studyLevels" TEXT;

