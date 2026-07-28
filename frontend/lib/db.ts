import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const dbUrl =
  process.env.NODE_ENV === 'test'
    ? (process.env.DATABASE_URL_TEST ||
       process.env.DATABASE_URL ||
       'postgresql://kindcaddy:kindcaddy_dev@localhost:5432/kindcaddy_test')
    : (process.env.DATABASE_URL ||
       'postgresql://kindcaddy:kindcaddy_dev@localhost:5432/kindcaddy');

// Amazon RDS serves a certificate signed by a regional root that chains up to the
// AWS RDS global CA, which is not in Node's default trust store. That caused
// node-postgres (the driver adapter) to reject the connection with "self-signed
// certificate in certificate chain" when sslmode=require. We fix it properly by
// shipping the public AWS RDS global CA bundle (certs/rds-global-bundle.pem) and
// verifying the chain + hostname against it. TLS behavior by sslmode/host:
//   - sslmode=no-verify: encrypt but skip verification (explicit operator choice, honored).
//   - RDS host, or sslmode in require/verify-ca/verify-full: load the CA bundle and do
//     REAL verification (ssl:{ca, rejectUnauthorized:true}). If the bundle cannot be
//     read, fall back to encrypt-without-verify but log a loud warning so the downgrade
//     is never silent.
//   - otherwise (e.g. local Postgres, no sslmode): no TLS (ssl undefined).
function createAdapter(): PrismaPg {
  try {
    const u = new URL(dbUrl);
    const sslmode = u.searchParams.get('sslmode') ?? '';
    const needsSsl =
      u.hostname.endsWith('rds.amazonaws.com') ||
      ['require', 'verify-ca', 'verify-full'].includes(sslmode);
    u.searchParams.delete('sslmode');

    let ssl: { ca?: string; rejectUnauthorized: boolean } | undefined;
    if (sslmode === 'no-verify') {
      // Operator explicitly opted out of verification — honor it.
      ssl = { rejectUnauthorized: false };
    } else if (needsSsl) {
      try {
        const bundle = fs.readFileSync(
          path.join(process.cwd(), 'certs', 'rds-global-bundle.pem'),
          'utf8',
        );
        ssl = { ca: bundle, rejectUnauthorized: true };
      } catch {
        console.error(
          '[db] SECURITY: AWS RDS CA bundle (certs/rds-global-bundle.pem) could not be ' +
            'read; falling back to encrypted-but-UNVERIFIED TLS. Server identity is NOT ' +
            'being verified — restore the CA bundle to re-enable certificate verification.',
        );
        ssl = { rejectUnauthorized: false };
      }
    } else {
      ssl = undefined;
    }

    return new PrismaPg({
      connectionString: u.toString(),
      ssl,
    });
  } catch {
    return new PrismaPg({ connectionString: dbUrl });
  }
}

const adapter = createAdapter();

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
