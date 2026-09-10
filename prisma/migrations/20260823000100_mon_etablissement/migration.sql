-- CreateEnum
CREATE TYPE "OrganizationCategory" AS ENUM ('TECH', 'BUSINESS_SCHOOL', 'COMMERCE', 'ENGINEERING', 'UNIVERSITY', 'IUT', 'BTS', 'CFA', 'LYCEE', 'COLLEGE', 'DESIGN', 'ART', 'COMMUNICATION', 'ONLINE', 'TRAINING_CENTER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('PUBLIC', 'PRIVATE', 'NONPROFIT', 'OTHER');

-- CreateEnum
CREATE TYPE "TeachingMode" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "AccessCodeRole" AS ENUM ('TEACHER', 'STUDENT');

-- CreateEnum
CREATE TYPE "AccessCodeStatus" AS ENUM ('ISSUED', 'ACTIVATED', 'REVOKED');

-- AlterEnum
ALTER TYPE "OrgRole" ADD VALUE 'ORG_SUPER_ADMIN';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "campusId" TEXT,
ADD COLUMN     "permissions" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "category" "OrganizationCategory",
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "languages" TEXT,
ADD COLUMN     "officialEmail" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "publicId" TEXT,
ADD COLUMN     "representativeFunction" TEXT,
ADD COLUMN     "requestedById" TEXT,
ADD COLUMN     "shortDescription" TEXT,
ADD COLUMN     "shortName" TEXT,
ADD COLUMN     "teachingMode" "TeachingMode",
ADD COLUMN     "type" "OrganizationType",
ADD COLUMN     "website" TEXT;

-- CreateTable
CREATE TABLE "Campus" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "address" TEXT,
    "postalCode" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "campusId" TEXT,
    "role" "AccessCodeRole" NOT NULL,
    "status" "AccessCodeStatus" NOT NULL DEFAULT 'ISSUED',
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "activatedById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Campus_organizationId_idx" ON "Campus"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Campus_organizationId_name_key" ON "Campus"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCode_code_key" ON "AccessCode"("code");

-- CreateIndex
CREATE INDEX "AccessCode_organizationId_status_idx" ON "AccessCode"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AccessCode_email_idx" ON "AccessCode"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AccessCode_organizationId_email_role_key" ON "AccessCode"("organizationId", "email", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_publicId_key" ON "Organization"("publicId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campus" ADD CONSTRAINT "Campus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessCode" ADD CONSTRAINT "AccessCode_activatedById_fkey" FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

