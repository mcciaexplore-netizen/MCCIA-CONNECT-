import { eq, inArray, type SQL } from 'drizzle-orm';
import { db, loadSettings } from './_lib.js';
import { studioDate } from './_availability.js';
import { FIELD, mappingOf, norm, ticketRows, type ColumnOf, type Row } from './_excel.js';
import { excelConfigured, forgetWorkbook, removeRows, syncSheet, upsertRows, warmUp, type Cell, type SheetRow, type SyncResult } from './_graph.js';
import { inBackground } from './_sessions.js';
import { adminNotifications, modules, tickets } from './_schema.js';
import { FEEDBACK_FIELDS, type StudioZone } from '../src/types/index.js';

/**
 * The studio's own workbook (a file on SharePoint, see _graph.ts) is kept up to date as things happen: a new booking adds a row to its
 * module's sheet and every later change (status, coordinator, forms, feedback, recording ...) updates that same row. The row of a ticket is found
 * by the ticket's number in the sheet's TICKET column. Only columns whose header is known are written: a column of the studio's own
 * (notes, say) is never touched, and the order and spelling of the headers is the studio's to choose.
 * Neon stays the source of truth. Three things keep the sheet right even when an update was missed (Microsoft unreachable, a server restart, a hand
 * edit): a change that failed is tried again with the next one, the daily job and "Sync everything" (Settings > Google) compare the whole sheet with the
 * database and put right what differs.
 */

/** Module slug -> its sheet in the workbook. (WORKSHOP and CLUSTER are not connected yet.) */
export const SHEETS: Record<string, string> = { 'ai-consultation': 'CONSULTATION', 'applet-setup': 'APPLET' };

/** What writing a module's sheet needs: its name, which header is the ticket column and which column holds dates. */
function sheetOf(slug: string) {
  const columnOf = mappingOf(slug);
  return {
    name: SHEETS[slug],
    isTicket: (header: string) => columnOf(header)?.header === FIELD.ticket,
    formats: [{ header: (header: string) => columnOf(header)?.header === FIELD.date, code: 'dd/mm/yyyy' }],
  };
}

const AVERAGE_RATING = norm('AVERAGE RATING OF THE CONSULTATION');

/** The average of the ratings the client gave, to one decimal (blank until they have rated). */
function averageRating(row: Row) {
  const given = FEEDBACK_FIELDS.map((f) => Number(row.ticket.feedbackData[f.key])).filter((n) => Number.isFinite(n) && n > 0);
  return given.length ? Math.round((given.reduce((sum, n) => sum + n, 0) / given.length) * 10) / 10 : '';
}

/** A date as Excel keeps it (days since 1900), so the sheet can sort and filter by it. */
const excelDate = (date: Date, tz: string) => {
  const [year, month, day] = studioDate(date, tz).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25_569;
};

/** The cells of a ticket's row, in the order of the sheet's headers: null for a column that is not ours. */
function sheetRow(row: Row, zone: StudioZone, columnOf: ColumnOf): SheetRow {
  return {
    id: row.ticket.ticketNumber,
    cells: (headers) =>
      headers.map((header): Cell => {
        if (norm(header) === AVERAGE_RATING) return averageRating(row);
        const column = columnOf(header);
        if (!column) return null;
        return column.header === FIELD.date ? excelDate(row.booking.startTime, zone.tz) : column.value(row, zone);
      }),
  };
}

// A failure is told to the admin (the dashboard) at most this often, so a Microsoft outage is one message, not one per booking.
const REPORT_EVERY = 30 * 60_000;
let lastReport = 0;
async function guarded(work: () => Promise<unknown>) {
  try {
    await work();
    return true;
  } catch (e) {
    forgetWorkbook(); // the file or its table may have been replaced: look again next time
    if (Date.now() - lastReport < REPORT_EVERY) {
      console.error('Excel sync failed:', e);
      return false;
    }
    lastReport = Date.now();
    throw e;
  }
}

export type Found = Awaited<ReturnType<typeof ticketRows>>[number];
const toSheetRow = (found: Found, zone: StudioZone) => sheetRow({ ...found, domain: found.module.name, srNo: found.booking.excelRowNumber ?? 0 }, zone, mappingOf(found.module.slug));

/** Writes these tickets' rows (found by the condition) into their sheets: updated where they are, added where they are not. */
export async function writeTickets(where: SQL) {
  warmUp(); // signing in and finding the file overlap with reading the database
  const settings = await loadSettings();
  const byModule = new Map<string, Map<string, SheetRow>>();
  for (const found of await ticketRows(where)) {
    if (!SHEETS[found.module.slug]) continue;
    const row = toSheetRow(found, settings.timezone);
    byModule.set(found.module.slug, (byModule.get(found.module.slug) ?? new Map()).set(row.id, row));
  }
  for (const [slug, rows] of byModule) {
    const { name, isTicket, formats } = sheetOf(slug);
    await upsertRows(name, isTicket, [...rows.values()], formats);
  }
  return [...byModule.values()].reduce((n, rows) => n + rows.size, 0);
}

// The first change is written at once; changes that come while that is being written (a bulk edit, a booking and its first edit) are written together
// right after, in the next run. A change that could not be written stays in the list for the next run, so it is retried with the next change.
const SETTLE_MS = 150; // the other changes of the same request arrive within this
const waiting = new Set<string>();
let running = false;

/** After anything changed on these tickets: their rows in the workbook are written (or added), after the answer has gone out. */
export function updateSheet(ticketIds: string[]) {
  if (!excelConfigured() || !ticketIds.length) return;
  for (const id of ticketIds) waiting.add(id);
  if (running) return; // the run in progress takes these when it has finished its own
  running = true;
  inBackground('Updating the Excel sheet', async () => {
    try {
      warmUp();
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      while (waiting.size) {
        const ids = [...waiting];
        waiting.clear();
        let written = false;
        try {
          written = await guarded(() => writeTickets(inArray(tickets.id, ids)));
        } finally {
          if (!written) for (const id of ids) waiting.add(id);
        }
        if (!written) break;
      }
    } finally {
      running = false;
    }
  });
}

/** After tickets were deleted: their rows leave the workbook. */
export function clearSheetRows(removed: { ticketNumber: string; moduleSlug: string }[]) {
  const mine = removed.filter((t) => SHEETS[t.moduleSlug]);
  if (!excelConfigured() || !mine.length) return;
  inBackground('Removing rows from the Excel sheet', () =>
    guarded(async () => {
      for (const slug of new Set(mine.map((t) => t.moduleSlug))) {
        await removeRows(SHEETS[slug], sheetOf(slug).isTicket, mine.filter((t) => t.moduleSlug === slug).map((t) => t.ticketNumber));
      }
    }),
  );
}

/** Every connected sheet is made to match the database (see syncSheet): what is missing is added, what differs is put right, what is gone is removed. */
export async function reconcileSheets(): Promise<SyncResult> {
  warmUp();
  const settings = await loadSettings();
  const total: SyncResult = { added: 0, updated: 0, removed: 0, duplicates: 0, skippedOrphans: 0 };
  for (const slug of Object.keys(SHEETS)) {
    const [module] = await db.select({ id: modules.id }).from(modules).where(eq(modules.slug, slug));
    if (!module) continue;
    const rows = (await ticketRows(eq(tickets.moduleId, module.id))).map((found) => toSheetRow(found, settings.timezone));
    const { name, isTicket, formats } = sheetOf(slug);
    const done = await syncSheet(name, isTicket, (id) => /^TKT-\d+$/.test(id), rows, formats);
    for (const key of Object.keys(total) as (keyof SyncResult)[]) total[key] += done[key];
  }
  return total;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Settings > Google > "Sync everything": the sheet is made to match the database. Says what it did on the dashboard when done. */
export async function syncEverything() {
  if (!excelConfigured()) return 0;
  const connected = await db.select({ id: modules.id }).from(modules).where(inArray(modules.slug, Object.keys(SHEETS)));
  const count = (await db.select({ id: tickets.id }).from(tickets).where(inArray(tickets.moduleId, connected.map((m) => m.id)))).length;
  inBackground('Syncing everything to the Excel sheet', async () => {
    const done = await reconcileSheets();
    const notes = [`${done.added} added`, `${done.updated} put right`, `${done.removed} removed`, ...(done.duplicates ? [`${plural(done.duplicates, 'duplicate')} taken out`] : [])];
    const warning = done.skippedOrphans ? ` ${plural(done.skippedOrphans, 'row')} of tickets that no longer exist were left in the sheet (that is a lot at once: check it).` : '';
    await db.insert(adminNotifications).values({ message: `Excel sheet synced (${plural(count, 'ticket')}): ${notes.join(', ')}.${warning}` });
  });
  return count;
}
