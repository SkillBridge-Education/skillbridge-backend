-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "canInviteTeachers" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "address" TEXT,
ADD COLUMN     "foundedOn" TIMESTAMP(3),
ADD COLUMN     "joinCode" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "specialties" TEXT;

-- CreateTable
CREATE TABLE "TeacherInvite" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "usedById" TEXT,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeacherInvite_code_key" ON "TeacherInvite"("code");

-- CreateIndex
CREATE INDEX "TeacherInvite_organizationId_usedAt_idx" ON "TeacherInvite"("organizationId", "usedAt");

-- CreateIndex
CREATE INDEX "TeacherInvite_expiresAt_idx" ON "TeacherInvite"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_joinCode_key" ON "Organization"("joinCode");

-- AddForeignKey
ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherInvite" ADD CONSTRAINT "TeacherInvite_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

