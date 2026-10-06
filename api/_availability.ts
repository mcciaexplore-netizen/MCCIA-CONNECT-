import { and, asc, eq, gt, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { db, HttpError } from './_lib.js';
import { bookings, clients, coordinators, modules, slotConfig, tickets } from './_schema.js';
import type { Availability, BookingMode, CoordinatorSlot, SlotInfo } from '../src/types/index.js';

// Slot config times are in studio time: the time zone in Settings (app_settings.timezone.tz).
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Config = typeof slotConfig.$inferSelect;
export type Taken = { startTime: Date; endTime: Date; mode: BookingMode };

/** How many minutes the zone is ahead of UTC at that instant (daylight saving included). */
function zoneOffset(tz: string, instant: number) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallClock = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return Math.round((wallClock - instant) / MINUTE);
}

/** The calendar date (YYYY-MM-DD) of an instant in studio time. */
export const studioDate = (instant: Date, tz: string) => new Date(instant.getTime() + zoneOffset(tz, instant.getTime()) * MINUTE).toISOString().slice(0, 10);

/** The instant a studio date and time ("HH:mm") happens. Two passes, so a time next to a daylight-saving change lands right. */
export function studioTime(date: string, time: string, tz: string) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const first = wall - zoneOffset(tz, wall) * MINUTE;
  return wall - zoneOffset(tz, first) * MINUTE;
}

/** The open ranges on a date: that date's overrides when there are any (a blocked one means none), else the weekly rules for its weekday. */
function hoursOn(rules: Availability, date: string) {
  const overrides = rules.dateOverrides.filter((o) => o.date === date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return overrides.length ? (overrides.some((o) => o.closed) ? [] : overrides) : rules.weeklyRules.filter((r) => r.day === weekday);
}

const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);

/**
 * Which modes still have room for [start, end). A booking blocks its own time plus the buffers around
 * it; a mode is open while fewer than its capacity (and fewer than max_parallel overall) are blocked.
 */
export function openModes(config: Config, taken: Taken[], start: Date, end: Date): BookingMode[] {
  const clashes = taken.filter(
    (b) => start.getTime() < b.endTime.getTime() + config.bufferAfter * MINUTE && end.getTime() > b.startTime.getTime() - config.bufferBefore * MINUTE,
  );
  if (clashes.length >= config.maxParallel) return [];
  const modes: BookingMode[] = [];
  if (clashes.filter((b) => b.mode === 'online').length < config.onlineCapacity) modes.push('online');
  if (clashes.filter((b) => b.mode === 'offline').length < config.offlineCapacity) modes.push('offline');
  return modes;
}

/**
 * Every slot the studio offers over `days` days from `from` (weekly rules, or that date's overrides), each with the modes
 * still open. A slot that is full has no modes. Slots inside the minimum-notice window are left out.
 */
export function computeSlots(config: Config, taken: Taken[], from: string, days: number, tz: string, now = new Date()): SlotInfo[] {
  const length = Math.max(5, config.slotIncrement) * MINUTE;
  const earliest = now.getTime() + config.minNotice * MINUTE;
  const slots: SlotInfo[] = [];

  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);

    for (const { start, end } of hoursOn(config, date)) {
      for (let t = studioTime(date, start, tz); t + length <= studioTime(date, end, tz); t += length) {
        if (t < earliest) continue;
        slots.push({ startsAt: new Date(t).toISOString(), endsAt: new Date(t + length).toISOString(), modes: openModes(config, taken, new Date(t), new Date(t + length)) });
      }
    }
  }
  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Non-cancelled bookings of a module near a time window (a day of margin covers the buffers). */
export async function takenAround(moduleId: string, from: Date, to: Date, excludeBookingId?: string): Promise<Taken[]> {
  return await db
    .select({ startTime: bookings.startTime, endTime: bookings.endTime, mode: bookings.mode })
    .from(bookings)
    .where(
      and(
        eq(bookings.moduleId, moduleId),
        ne(bookings.status, 'cancelled'),
        gt(bookings.endTime, new Date(from.getTime() - DAY)),
        lt(bookings.startTime, new Date(to.getTime() + DAY)),
        excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
      ),
    );
}

/**
 * A module's slot config and its slots (see computeSlots); config is null until an admin sets it up.
 * `excludeBookingId` leaves one booking out of what is taken (rescheduling it must not block its own time).
 */
export async function loadAvailability(moduleId: string, from: string, days: number, tz: string, excludeBookingId?: string) {
  const [config] = await db.select().from(slotConfig).where(eq(slotConfig.moduleId, moduleId));
  if (!config) return { config: null, slots: [] as SlotInfo[] };
  const windowStart = new Date(studioTime(from, '00:00', tz));
  const taken = await takenAround(moduleId, windowStart, new Date(windowStart.getTime() + days * DAY), excludeBookingId);
  return { config, slots: computeSlots(config, taken, from, days, tz) };
}

// ---------- a coordinator's own hours and calendar ----------

/** Whether [start, end) fits inside one of the coordinator's own ranges that day (studio time). No personal hours set means no limit. */
export function withinHours(availability: Availability | null, start: Date, end: Date, tz: string) {
  if (!availability) return true;
  const date = studioDate(start, tz);
  return hoursOn(availability, date).some((range) => studioTime(date, range.start, tz) <= start.getTime() && end.getTime() <= studioTime(date, range.end, tz));
}

/** The coordinator's live (not cancelled) sessions that overlap [start, end): a coordinator is never in two places at once. */
export async function clashesOf(coordinatorId: string, start: Date, end: Date, excludeBookingId?: string) {
  return await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.coordinatorId, coordinatorId), ne(bookings.status, 'cancelled'), lt(bookings.startTime, end), gt(bookings.endTime, start), excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined));
}

/**
 * Throws 409 unless the coordinator can take a session at [start, end): inside their own hours (when they set any) and with no
 * other live session overlapping. `forClient` words the message for the person booking on the public page.
 */
export async function ensureCoordinatorFree(
  coordinator: { id: string; name: string; availability: Availability | null },
  start: Date,
  end: Date,
  tz: string,
  { forClient = false, excludeBookingId }: { forClient?: boolean; excludeBookingId?: string } = {},
) {
  const who = forClient ? 'Your coordinator' : coordinator.name;
  if (!withinHours(coordinator.availability, start, end, tz)) throw new HttpError(409, `${who} is not available at that time. Please pick another.`);
  if ((await clashesOf(coordinator.id, start, end, excludeBookingId)).length) throw new HttpError(409, `${who} already has a session at that time. Please pick another.`);
}

/** Every active coordinator who can take a session at [start, end): inside their own hours and with no other live session overlapping. */
export async function freeCoordinators(start: Date, end: Date, tz: string) {
  const [active, busy] = await Promise.all([
    db.select().from(coordinators).where(eq(coordinators.isActive, true)).orderBy(asc(coordinators.name)),
    db
      .select({ id: bookings.coordinatorId })
      .from(bookings)
      .where(and(isNotNull(bookings.coordinatorId), ne(bookings.status, 'cancelled'), lt(bookings.startTime, end), gt(bookings.endTime, start))),
  ]);
  const taken = new Set(busy.map((b) => b.id));
  return active.filter((c) => !taken.has(c.id) && withinHours(c.availability, start, end, tz));
}

/**
 * Of these coordinators, the one with the fewest sessions in the calendar month (studio time) of `start`, so new clients spread evenly.
 * A tie is settled at random. Cancelled sessions do not count.
 */
export async function leastLoaded<T extends { id: string }>(candidates: T[], start: Date, tz: string): Promise<T> {
  const [year, month] = studioDate(start, tz).split('-').map(Number);
  const first = (y: number, m: number) => new Date(studioTime(`${y}-${String(m).padStart(2, '0')}-01`, '00:00', tz));
  const counts = await db
    .select({ id: bookings.coordinatorId, n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(inArray(bookings.coordinatorId, candidates.map((c) => c.id)), ne(bookings.status, 'cancelled'), gte(bookings.startTime, first(year, month)), lt(bookings.startTime, month === 12 ? first(year + 1, 1) : first(year, month + 1))))
    .groupBy(bookings.coordinatorId);
  const load = new Map(counts.map((row) => [row.id, row.n]));
  const fewest = Math.min(...candidates.map((c) => load.get(c.id) ?? 0));
  const tied = candidates.filter((c) => (load.get(c.id) ?? 0) === fewest);
  return tied[Math.floor(Math.random() * tied.length)];
}

/**
 * A coordinator's calendar over `days` days: their own sessions (booked), and the slots they can still be booked in (available):
 * a slot of an active service that has room, falls inside their hours and overlaps none of their sessions.
 */
export async function coordinatorCalendar(coordinator: { id: string; availability: Availability | null }, from: string, days: number, tz: string): Promise<CoordinatorSlot[]> {
  const windowStart = new Date(studioTime(from, '00:00', tz));
  const windowEnd = new Date(windowStart.getTime() + days * DAY);
  const [services, sessions] = await Promise.all([
    db.select({ config: slotConfig, name: modules.name }).from(slotConfig).innerJoin(modules, and(eq(slotConfig.moduleId, modules.id), eq(modules.isActive, true))),
    db
      .select({ booking: bookings, ticket: tickets, client: clients, module: modules })
      .from(bookings)
      .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
      .innerJoin(clients, eq(bookings.clientId, clients.id))
      .innerJoin(modules, eq(bookings.moduleId, modules.id))
      .where(and(eq(bookings.coordinatorId, coordinator.id), ne(bookings.status, 'cancelled'), gt(bookings.endTime, windowStart), lt(bookings.startTime, windowEnd)))
      .orderBy(asc(bookings.startTime)),
  ]);

  const booked: CoordinatorSlot[] = sessions.map(({ booking, ticket, client, module }) => ({
    startsAt: booking.startTime.toISOString(),
    endsAt: booking.endTime.toISOString(),
    state: 'booked',
    services: [],
    booking: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, clientName: client.personName, companyName: client.companyName, moduleName: module.name, mode: booking.mode, status: booking.status },
  }));

  const free = new Map<string, CoordinatorSlot>(); // one row per time, listing every service that can be booked in it
  await Promise.all(
    services.map(async ({ config, name }) => {
      for (const slot of computeSlots(config, await takenAround(config.moduleId, windowStart, windowEnd), from, days, tz)) {
        const start = new Date(slot.startsAt);
        const end = new Date(slot.endsAt);
        if (!slot.modes.length || !withinHours(coordinator.availability, start, end, tz) || sessions.some((s) => s.booking.startTime < end && s.booking.endTime > start)) continue;
        const row = free.get(slot.startsAt + slot.endsAt) ?? { startsAt: slot.startsAt, endsAt: slot.endsAt, state: 'available' as const, services: [] };
        row.services.push(name);
        free.set(slot.startsAt + slot.endsAt, row);
      }
    }),
  );
  return [...booked, ...free.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

// ---------- reading hours from a request ----------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

const time = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !TIME.test(value)) throw new HttpError(400, `${label} must be a time like 10:00`);
  return value;
};

/** A whole number within [min, max]. */
export const count = (value: unknown, label: string, min: number, max = 100_000) => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}`);
  return value as number;
};

const list = (value: unknown, label: string) => {
  if (!Array.isArray(value)) throw new HttpError(400, `${label} must be a list`);
  return value as Record<string, unknown>[];
};

/** Weekly ranges and date overrides from a request body, checked. Used for a service's slot config and for a coordinator's own hours. */
export function parseHours(body: Record<string, unknown>): Availability {
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
  return { weeklyRules, dateOverrides };
}
