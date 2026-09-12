-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PAID', 'REFUNDED');

-- CreateTable
CREATE TABLE "CreditPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'eur',
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PAID',
    "refundedAt" TIMESTAMP(3),
    "refundNote" TEXT,
    "capBefore" INTEGER NOT NULL,
    "capAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditPurchase_userId_createdAt_idx" ON "CreditPurchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditPurchase_createdAt_idx" ON "CreditPurchase"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditPurchase_provider_reference_key" ON "CreditPurchase"("provider", "reference");

-- AddForeignKey
ALTER TABLE "CreditPurchase" ADD CONSTRAINT "CreditPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

