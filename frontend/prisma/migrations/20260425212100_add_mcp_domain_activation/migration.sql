-- CreateTable
CREATE TABLE "TenantMcpDomain" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TenantMcpDomain_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TenantMcpDomain_tenantId_idx" ON "TenantMcpDomain"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMcpDomain_tenantId_domain_key" ON "TenantMcpDomain"("tenantId", "domain");

-- Seed defaults for existing tenants.
INSERT INTO "TenantMcpDomain" ("id", "tenantId", "domain", "active", "createdAt", "updatedAt")
SELECT 'cmd_' || "id" || '_finance', "id", 'finance', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Tenant";

INSERT INTO "TenantMcpDomain" ("id", "tenantId", "domain", "active", "createdAt", "updatedAt")
SELECT 'cmd_' || "id" || '_customer', "id", 'customer', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Tenant";

INSERT INTO "TenantMcpDomain" ("id", "tenantId", "domain", "active", "createdAt", "updatedAt")
SELECT 'cmd_' || "id" || '_agent', "id", 'agent', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Tenant";
