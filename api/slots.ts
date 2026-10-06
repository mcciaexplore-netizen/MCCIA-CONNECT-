import { and, eq } from 'drizzle-orm';
import { audit, cached, db, handler, HttpError, loadSettings, needString, readBody, requireUser, UUID } from './_lib.js';
import { coordinatorCalendar, count, DATE, loadAvailability, parseHours, studioDate } from './_availability.js';
import { coordinators, modules, slotConfig } from './_schema.js';

const MAX_DAYS = 70; // enough for the rest of this month and all of next

export default handler({
  // ?module=slug is public: that module's slots, taken ones included with no modes (from=YYYY-MM-DD, days up to 70).
  // ?coordinator=<id> (or "me") is a coordinator's calendar: their sessions and the slots they can still be booked in. A coordinator only gets their own; an admin any.
  // Without either, admins get the slot configs.
  GET: async (req, url) => {
    const slug = url.searchParams.get('module');
    const who = url.searchParams.get('coordinator');
    if (!slug && !who) {
      await requireUser(req, 'super_admin');
      return await db.select().from(slotConfig);
    }

    const { tz } = (await loadSettings()).timezone;
    const from = url.searchParams.get('from') ?? studioDate(new Date(), tz);
    if (!DATE.test(from)) throw new HttpError(400, 'from must be a date like 2026-10-12');
    const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 30));

    if (who) {
      const user = await requireUser(req);
      const id = who === 'me' ? user.coordinatorId : who;
      if (!id || !UUID.test(id) || (user.role !== 'super_admin' && id !== user.coordinatorId)) throw new HttpError(404, 'Coordinator not found');
      const [coordinator] = await db.select().from(coordinators).where(eq(coordinators.id, id));
      if (!coordinator) throw new HttpError(404, 'Coordinator not found');
      return await coordinatorCalendar(coordinator, from, days, tz);
    }

    const [module] = await db.select({ id: modules.id }).from(modules).where(and(eq(modules.slug, slug!), eq(modules.isActive, true)));
    if (!module) throw new HttpError(404, 'This booking page does not exist');
    // Kept for 10 s by the CDN: a slot taken in that moment is caught by the booking itself (it re-checks and says so).
    return cached((await loadAvailability(module.id, from, days, tz)).slots, 10);
  },

  // Saves (creates or replaces) a module's slot config.
  PUT: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const moduleId = needString(body.moduleId, 'Module');
    const { weeklyRules, dateOverrides } = parseHours(body);

    const values = {
      moduleId,
      weeklyRules,
      dateOverrides,
      bufferBefore: count(body.bufferBefore, 'Buffer before', 0, 1440),
      bufferAfter: count(body.bufferAfter, 'Buffer after', 0, 1440),
      minNotice: count(body.minNotice, 'Minimum notice', 0, 525_600),
      slotIncrement: count(body.slotIncrement, 'Slot length', 5, 1440),
      maxParallel: count(body.maxParallel, 'Max parallel', 1, 1000),
      onlineCapacity: count(body.onlineCapacity, 'Online capacity', 0, 1000),
      offlineCapacity: count(body.offlineCapacity, 'Offline capacity', 0, 1000),
    };

    const [config] = await db.insert(slotConfig).values(values).onConflictDoUpdate({ target: slotConfig.moduleId, set: values }).returning();
    await audit(user, 'slots.configured', 'module', moduleId, undefined, {
      slotLength: values.slotIncrement,
      weeklyRanges: weeklyRules.length,
      overrides: dateOverrides.length,
      online: values.onlineCapacity,
      offline: values.offlineCapacity,
    });
    return config;
  },
});
