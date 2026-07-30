import { PrismaClient } from '../generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'path';

// Resolve db path from root
const dbPath = process.env.DATABASE_URL 
    ? process.env.DATABASE_URL.replace('file:', '') 
    : path.resolve(__dirname, '../dev.db');
const adapter = new PrismaBetterSqlite3({ url: dbPath });

const prisma = new PrismaClient({ adapter });

export default prisma;
