-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL DEFAULT 'explicit',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemorySetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'smart',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemorySetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMemory_userId_tenantId_idx" ON "UserMemory"("userId", "tenantId");

-- CreateIndex
CREATE INDEX "UserMemory_createdAt_idx" ON "UserMemory"("createdAt");

-- CreateIndex
CREATE INDEX "UserMemorySetting_userId_idx" ON "UserMemorySetting"("userId");

-- CreateIndex
CREATE INDEX "UserMemorySetting_tenantId_idx" ON "UserMemorySetting"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemorySetting_userId_tenantId_key" ON "UserMemorySetting"("userId", "tenantId");
