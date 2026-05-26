-- Simplify roles to 'admin' | 'employee' and introduce per-user MCP domain access.

-- 1. Collapse legacy roles in the Membership table.
--    'owner' becomes 'admin'; 'editor' and 'viewer' become 'employee'.
UPDATE "Membership" SET "role" = 'admin'    WHERE "role" = 'owner';
UPDATE "Membership" SET "role" = 'employee' WHERE "role" IN ('editor', 'viewer');

-- 2. Per-user (employee) override of which MCP domains they can access.
CREATE TABLE "UserMcpDomainAccess" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMcpDomainAccess_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "User"   ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserMcpDomainAccess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "UserMcpDomainAccess_userId_tenantId_domain_key"
    ON "UserMcpDomainAccess" ("userId", "tenantId", "domain");
CREATE INDEX "UserMcpDomainAccess_userId_idx"   ON "UserMcpDomainAccess" ("userId");
CREATE INDEX "UserMcpDomainAccess_tenantId_idx" ON "UserMcpDomainAccess" ("tenantId");
