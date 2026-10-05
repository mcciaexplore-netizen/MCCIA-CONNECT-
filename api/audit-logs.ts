import { desc } from 'drizzle-orm';
import { db, handler, requireUser } from './_lib.js';
import { auditLogs } from './_schema.js';

export default handler({
  GET: async (req) => {
    await requireUser(req, 'admin');
    return await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(500);
  },
});
