import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { studioTime } from './_availability.js';
import { db, handler, HttpError, loadSettings, readBody, requireUser, UUID } from './_lib.js';
import { adminNotifications, auditLogs } from './_schema.js';

const PAGE_SIZE = 50;
const MAX_PAGE = 200;
const MAX_ENTITIES = 200;
const MAX_NOTICES = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const dayStart = (date: string, tz: string, plusDays = 0) => new Date(studioTime(date, '00:00', tz) + plusDays * 24 * 60 * 60 * 1000);

export default handler({
  // Admin only. Two shapes:
  //  ?entities=id,id   every entry about those records (a ticket's or a client's timeline), newest first;
  //  otherwise one page of the whole log: ?limit (50, up to 200) &cursor (the previous page's nextCursor) and the filters
  //  action, doneBy, from / to (YYYY-MM-DD, in the studio's time zone). The filters run here, so they cover the whole log.
  //  ?notifications=1   the dashboard's messages that nobody has dismissed yet (a company that was auto-assigned a coordinator, ...).
  GET: async (req, url) => {
    await requireUser(req, 'super_admin');
    const q = url.searchParams;

    if (q.has('notifications')) return await db.select().from(adminNotifications).where(isNull(adminNotifications.dismissedAt)).orderBy(desc(adminNotifications.createdAt)).limit(MAX_NOTICES);

    const entities = q.get('entities');
    if (entities !== null) {
      const ids = entities.split(',').filter(Boolean);
      if (ids.length > MAX_ENTITIES || !ids.every((id) => UUID.test(id))) throw new HttpError(400, `entities must be up to ${MAX_ENTITIES} ids`);
      if (!ids.length) return { logs: [], nextCursor: null, actions: [], people: [] };
      const logs = await db.select().from(auditLogs).where(inArray(auditLogs.entityId, ids)).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id));
      return { logs, nextCursor: null, actions: [], people: [] };
    }

    const { tz } = (await loadSettings()).timezone;
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(q.get('limit')) || PAGE_SIZE));
    const from = q.get('from');
    const to = q.get('to');
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new HttpError(400, 'from and to must be dates like 2026-10-12');
    const [cursorAt, cursorId] = (q.get('cursor') ?? '').split('|');
    if (q.get('cursor') && (Number.isNaN(Date.parse(cursorAt)) || !UUID.test(cursorId ?? ''))) throw new HttpError(400, 'Invalid cursor');

    const where = and(
      q.get('action') ? eq(auditLogs.action, q.get('action')!) : undefined,
      q.get('doneBy') ? eq(auditLogs.doneByName, q.get('doneBy')!) : undefined,
      from ? gte(auditLogs.createdAt, dayStart(from, tz)) : undefined,
      to ? lt(auditLogs.createdAt, dayStart(to, tz, 1)) : undefined,
      // Keyset paging: everything strictly older than the last row of the previous page.
      cursorId ? or(lt(auditLogs.createdAt, new Date(cursorAt)), and(eq(auditLogs.createdAt, new Date(cursorAt)), lt(auditLogs.id, cursorId))) : undefined,
    );
    const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit + 1);
    const logs = rows.slice(0, limit);
    const last = logs.at(-1);

    // The filter lists cover the whole log, not just this page.
    const [actions, people] = await Promise.all([
      db.selectDistinct({ value: auditLogs.action }).from(auditLogs).orderBy(auditLogs.action),
      db.selectDistinct({ value: auditLogs.doneByName }).from(auditLogs).where(sql`${auditLogs.doneByName} is not null`).orderBy(auditLogs.doneByName),
    ]);
    return {
      logs,
      nextCursor: rows.length > limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      actions: actions.map((a) => a.value),
      people: people.map((p) => p.value as string),
    };
  },

  // Dismisses a dashboard message ({ id }), or all of them ({ all: true }).
  PATCH: async (req) => {
    await requireUser(req, 'super_admin');
    const body = await readBody(req);
    if (body.all !== true && !(typeof body.id === 'string' && UUID.test(body.id))) throw new HttpError(400, 'Say which message');
    await db.update(adminNotifications).set({ dismissedAt: new Date() }).where(and(isNull(adminNotifications.dismissedAt), body.all === true ? undefined : eq(adminNotifications.id, body.id as string)));
    return { ok: true };
  },
});
