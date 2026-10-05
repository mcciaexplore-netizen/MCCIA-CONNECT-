import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// SERVER ONLY: imported by the Vercel functions in /api (through api/_lib.ts), never by browser code.
const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql);
