import 'dotenv/config';
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

const adapter = new PrismaPg({ connectionString: dbUrl });

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
