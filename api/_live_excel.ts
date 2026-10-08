import { inArray, type SQL } from 'drizzle-orm';
import { db, loadSettings } from './_lib.js';
import { studioDate } from './_availability.js';
import { COLUMNS, ticketRows, type Row } from './_excel.js';
import { excelConfigured, forgetWorkbook, removeRows, upsertRows, type Cell, type SheetRow } from './_graph.js';
import { inBackground } from './_sessions.js';
import { adminNotifications, modules, tickets } from './_schema.js';
import { FEEDBACK_FIELDS, type StudioZone } from '../src/types/index.js';

/**
 * The studio's own workbook (a file on SharePoint, see _graph.ts) is kept up to date as things happen: a new booking adds a row to its
 * module's sheet and every later change (status, coordinator, forms, feedback, recording ...) updates that same row. The row of a ticket is found
 * by the ticket's number in the sheet's TICKET column. Only columns whose header is known are written: a column of the studio's own
 * (notes, say) is never touched, and the order and spelling of the headers is the studio's to choose.
 * Neon stays the source of truth: "Sync everything" (Settings > Google) writes every row again.
 */

/** Module slug -> its sheet in the workbook. (The other sheets are not connected yet.) */
const SHEETS: Record<string, string> = { 'ai-consultation': 'CONSULTATION' };

const norm = (text: string) => text.toUpperCase().replace(/\s+/g, '');

/** Headers as the workbook spells them (typos included) -> the download column that holds the same thing. Others match by their own name. */
const ALIASES: Record<string, string> = {
  'SR NO': 'Sr. No',
  'TICKET': 'Ticket ID',
  'CONTACT': 'Contact / Phone',
  'PAYMENT': 'Payment Status',
  'CONSLTATION STATUS': 'Consultation Status',
  'HOD/COORDINATOR ASSIGNED': 'Coordinator Assigned',
  'MEMBER/ NON MEMBER': 'Member / Non-Member',
  'AQUISTION FROM': 'Acquisition From',
  'TIME SPAN': 'Time Span (minutes)',
  'AVERAGE RATE OF THE SOLUTION': 'Rate solution/recommendation',
  'RATE THE CONSULTANT': 'Rate understanding level',
  'ADDITIONAL SUGGESTION': 'Additional Suggestions',
  'EMPLOYEMENT RANGE': 'Employment Range',
  'ESTIMANTED BUDGET FOR AI': 'Estimated Budget for AI',
  'ONLINE PRESENSE': 'Online Presence',
  'ACCOUTING/GST': 'Accounting & GST',
  'DATA USAGE IN DECISION': 'Data Usage in Decisions',
  'SYSTEM INTEGRATIONS': 'System Integration',
  'ATTENDANCE/PAYROLL MANGEMENT': 'Attendance & Payroll Management',
  'DASHBOARD TOOL': 'Dashboard Tools',
  'TIME COST(IN HOURS)': 'Time Cost (hours)',
  'MONEY COST(INR)': 'Money Cost (INR)',
  'IMPLEMENTATION LEVEL': 'AI Implementation Level',
};
const aliases = new Map(Object.entries(ALIASES).map(([sheet, column]) => [norm(sheet), norm(column)]));
const columns = new Map(COLUMNS.map((column) => [norm(column.header), column]));
const columnOf = (header: string) => columns.get(aliases.get(norm(header)) ?? norm(header));

const isTicketHeader = (header: string) => columnOf(header)?.header === 'Ticket ID';
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
const DATE_FORMAT = { header: (header: string) => columnOf(header)?.header === 'Date', code: 'dd/mm/yyyy' };

/** The cells of a ticket's row, in the order of the sheet's headers: null for a column that is not ours. */
function sheetRow(row: Row, zone: StudioZone): SheetRow {
  return {
    id: row.ticket.ticketNumber,
    cells: (headers) =>
      headers.map((header): Cell => {
        if (norm(header) === AVERAGE_RATING) return averageRating(row);
        const column = columnOf(header);
        if (!column) return null;
        return column.header === 'Date' ? excelDate(row.booking.startTime, zone.tz) : column.value(row, zone);
      }),
  };
}

// A failure is told to the admin (the dashboard) at most this often, so a Microsoft outage is one message, not one per booking.
const REPORT_EVERY = 30 * 60_000;
let lastReport = 0;
async function guarded(work: () => Promise<unknown>) {
  try {
    await work();
  } catch (e) {
    forgetWorkbook(); // the file or its table may have been replaced: look again next time
    if (Date.now() - lastReport < REPORT_EVERY) return void console.error('Excel sync failed:', e);
    lastReport = Date.now();
    throw e;
  }
}

export async function writeTickets(where: SQL) {
  const settings = await loadSettings();
  const bySheet = new Map<string, Map<string, SheetRow>>();
  for (const found of await ticketRows(where)) {
    const sheet = SHEETS[found.module.slug];
    if (!sheet) continue;
    const row = sheetRow({ ...found, domain: found.module.name, srNo: found.booking.excelRowNumber ?? 0 }, settings.timezone);
    bySheet.set(sheet, (bySheet.get(sheet) ?? new Map()).set(row.id, row));
  }
  for (const [sheet, rows] of bySheet) await upsertRows(sheet, isTicketHeader, [...rows.values()], [DATE_FORMAT]);
  return [...bySheet.values()].reduce((n, rows) => n + rows.size, 0);
}

// Changes that come close together (a bulk status change, a booking and its first edit) are written in one go.
const PAUSE_MS = 1500;
const waiting = new Set<string>();
let flush: Promise<unknown> | undefined;

/** After anything changed on these tickets: their rows in the workbook are written (or added) a moment later, after the answer has gone out. */
export function updateSheet(ticketIds: string[]) {
  if (!excelConfigured() || !ticketIds.length) return;
  for (const id of ticketIds) waiting.add(id);
  if (flush) return; // the pending write will take these too
  flush = new Promise((resolve) => setTimeout(resolve, PAUSE_MS)).then(() => {
    const ids = [...waiting];
    waiting.clear();
    flush = undefined;
    return guarded(() => writeTickets(inArray(tickets.id, ids)));
  });
  const pending = flush;
  inBackground('Updating the Excel sheet', () => pending);
}

/** After tickets were deleted: their rows leave the workbook. */
export function clearSheetRows(removed: { ticketNumber: string; moduleSlug: string }[]) {
  const mine = removed.filter((t) => SHEETS[t.moduleSlug]);
  if (!excelConfigured() || !mine.length) return;
  inBackground('Removing rows from the Excel sheet', () =>
    guarded(async () => {
      for (const sheet of new Set(mine.map((t) => SHEETS[t.moduleSlug]))) {
        await removeRows(sheet, isTicketHeader, mine.filter((t) => SHEETS[t.moduleSlug] === sheet).map((t) => t.ticketNumber));
      }
    }),
  );
}

/** Settings > Google > "Sync everything": every ticket of the connected modules is written again. Says how many on the dashboard when done. */
export async function syncEverything() {
  if (!excelConfigured()) return 0;
  const connected = await db.select({ id: modules.id }).from(modules).where(inArray(modules.slug, Object.keys(SHEETS)));
  const count = (await db.select({ id: tickets.id }).from(tickets).where(inArray(tickets.moduleId, connected.map((m) => m.id)))).length;
  inBackground('Syncing everything to the Excel sheet', async () => {
    await writeTickets(inArray(tickets.moduleId, connected.map((m) => m.id)));
    await db.insert(adminNotifications).values({ message: `Excel sheet synced: ${count} ticket${count === 1 ? '' : 's'} written.` });
  });
  return count;
}
