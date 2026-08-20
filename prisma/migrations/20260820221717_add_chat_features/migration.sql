-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedForEveryone" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "fileName" TEXT,
ADD COLUMN     "pinnedAt" TIMESTAMP(3),
ADD COLUMN     "pinnedById" TEXT,
ADD COLUMN     "replyToId" TEXT;

-- CreateTable
CREATE TABLE "MessageHide" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageHide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageHide_userId_idx" ON "MessageHide"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageHide_messageId_userId_key" ON "MessageHide"("messageId", "userId");

-- CreateIndex
CREATE INDEX "Message_conversationId_pinnedAt_idx" ON "Message"("conversationId", "pinnedAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageHide" ADD CONSTRAINT "MessageHide_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageHide" ADD CONSTRAINT "MessageHide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

