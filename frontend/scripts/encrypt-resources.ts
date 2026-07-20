/**
 * One-off migration (PRODUCTION-PLAN.md Phase 3.5): encrypt any plaintext
 * integration-secret rows in `Resource.data` with the current
 * RESOURCE_ENCRYPTION_KEY.
 *
 * Usage: RESOURCE_ENCRYPTION_KEY=... npx tsx scripts/encrypt-resources.ts
 *
 * Idempotent — already-encrypted rows (enc:v1: prefix) are skipped, so it is
 * safe to re-run.
 */

import 'dotenv/config';
import { db } from '../lib/db';
import { encryptString, isEncrypted } from '../lib/crypto';

// Only rows that hold secrets are encrypted; generic resources stay
// queryable. Extend this list as new integrations land (netsuite_connection,
// icloud_calendar_connection, ...).
const SECRET_RESOURCE_NAMES = [
  'google_calendar_connection',
  'netsuite_connection',
  'icloud_calendar_connection',
];

async function main() {
  if (!process.env.RESOURCE_ENCRYPTION_KEY) {
    console.error('RESOURCE_ENCRYPTION_KEY must be set to run this migration.');
    process.exit(1);
  }

  const rows = await db.resource.findMany({
    where: { name: { in: SECRET_RESOURCE_NAMES } },
    select: { id: true, name: true, data: true },
  });

  let migrated = 0;
  let skipped = 0;
  for (const row of rows) {
    if (isEncrypted(row.data)) {
      skipped += 1;
      continue;
    }
    await db.resource.update({
      where: { id: row.id },
      data: { data: encryptString(row.data) },
    });
    migrated += 1;
  }

  console.log(
    `encrypt-resources: ${migrated} row(s) encrypted, ${skipped} already encrypted, ${rows.length} total.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
