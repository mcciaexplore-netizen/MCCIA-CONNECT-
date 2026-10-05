import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { db } from './_lib.js';
import { bookings, slotConfig } from './_schema.js';
import type { BookingMode, SlotInfo } from '../src/types/index.js';

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
    const overrides = config.dateOverrides.filter((o) => o.date === date);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const hours = overrides.length ? (overrides.some((o) => o.closed) ? [] : overrides) : config.weeklyRules.filter((r) => r.day === weekday);

    for (const { start, end } of hours) {
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
