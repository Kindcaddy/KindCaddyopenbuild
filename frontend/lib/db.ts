import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const dbUrl = process.env.NODE_ENV === 'test' 
  ? (process.env.DATABASE_URL_TEST || process.env.DATABASE_URL || 'file:./test.db')
  : (process.env.DATABASE_URL || 'file:./dev.db');
const adapter = new PrismaBetterSqlite3({ url: dbUrl });

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
