import { and, eq } from 'drizzle-orm';
import { audit, db, handler, HttpError, loadSettings, needString, readBody, requireUser } from './_lib.js';
import { loadAvailability, studioDate } from './_availability.js';
import { modules, slotConfig } from './_schema.js';

const MAX_DAYS = 70; // enough for the rest of this month and all of next
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const time = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !TIME.test(value)) throw new HttpError(400, `${label} must be a time like 10:00`);
  return value;
};

/** A whole number within [min, max]. */
const count = (value: unknown, label: string, min: number, max = 100_000) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
  return value as number;
};

const list = (value: unknown, label: string) => {
  if (!Array.isArray(value)) throw new HttpError(400, `${label} must be a list`);
  return value as Record<string, unknown>[];
};

export default handler({
  // ?module=slug is public: that module's slots, taken ones included with no modes (from=YYYY-MM-DD, days up to 70). Without it, admins get the slot configs.
  GET: async (req, url) => {
    const slug = url.searchParams.get('module');
    if (!slug) {
      await requireUser(req, 'super_admin');
      return await db.select().from(slotConfig);
    }

    const [module] = await db.select({ id: modules.id }).from(modules).where(and(eq(modules.slug, slug), eq(modules.isActive, true)));
    if (!module) throw new HttpError(404, 'This booking page does not exist');
    const { tz } = (await loadSettings()).timezone;
    const from = url.searchParams.get('from') ?? studioDate(new Date(), tz);
    if (!DATE.test(from)) throw new HttpError(400, 'from must be a date like 2026-10-12');
    const days = Math.min(MAX_DAYS, Math.max(1, Number(url.searchParams.get('days')) || 30));
    return (await loadAvailability(module.id, from, days, tz)).slots;
  },

  // Saves (creates or replaces) a module's slot config.
  PUT: async (req) => {
    const user = await requireUser(req, 'super_admin');
    const body = await readBody(req);
    const moduleId = needString(body.moduleId, 'Module');

    const weeklyRules = list(body.weeklyRules, 'Weekly hours').map((r) => {
      const rule = { day: count(r.day, 'Weekday', 0, 6), start: time(r.start, 'Start'), end: time(r.end, 'End') };
      if (rule.end <= rule.start) throw new HttpError(400, 'Each weekly range must end after it starts');
      return rule;
    });
    const dateOverrides = list(body.dateOverrides, 'Date overrides').map((o) => {
      if (typeof o.date !== 'string' || !DATE.test(o.date)) throw new HttpError(400, 'Override dates must look like 2026-10-12');
      const closed = Boolean(o.closed);
      if (closed) return { date: o.date, closed, start: '00:00', end: '00:00' };
      const override = { date: o.date, closed, start: time(o.start, 'Start'), end: time(o.end, 'End') };
      if (override.end <= override.start) throw new HttpError(400, 'Each override must end after it starts');
      return override;
    });

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
