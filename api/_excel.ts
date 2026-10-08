import ExcelJS from 'exceljs';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, HttpError } from './_lib.js';
import { auditLogs, bookings, clients, coordinators, modules, tickets } from './_schema.js';
import { CLIENT_FIELDS, DEFAULT_POST_CONSULTATION_QUESTIONS, FEEDBACK_COMMENTS, FEEDBACK_COMMENTS_LABEL, FEEDBACK_FIELDS, PAYMENT_LABELS, STATUS_LABELS, clientText, type AppSettings, type StudioZone } from '../src/types/index.js';

/**
 * The download: an Excel file generated fresh from Neon every time, so notes, statuses, feedback and links are always current (the
 * studio's own live workbook on SharePoint is kept up to date separately, see _live_excel.ts). The only thing kept is
 * bookings.excel_row_number: the booking's Sr. No in its module's tab, assigned when it is booked.
 */

/** SQL for the next Sr. No in a module's tab; used as the excel_row_number when a booking is inserted. */
export const nextRowNumber = (moduleId: string) =>
  sql<number>`(select coalesce(max(${bookings.excelRowNumber}), 0) + 1 from ${bookings} where ${bookings.moduleId} = ${moduleId})`;

export interface Row {
  srNo: number;
  domain: string; // the module (its tab)
  ticket: typeof tickets.$inferSelect;
  booking: typeof bookings.$inferSelect;
  client: typeof clients.$inferSelect;
  coordinator: string | null;
}

// Dates and times are shown in studio time (the time zone in Settings), whatever time zone the server runs in.
const zoned = (zone: StudioZone, options: Intl.DateTimeFormatOptions) => (date: Date) => new Intl.DateTimeFormat('en-US', { timeZone: zone.tz, ...options }).format(date);
const dateText = (zone: StudioZone, date: Date) => {
  const [month, day, year] = zoned(zone, { day: '2-digit', month: '2-digit', year: 'numeric' })(date).split('/'); // MM/DD/YYYY
  return `${day}/${month}/${year}`; // DD/MM/YYYY
};
const monthText = (zone: StudioZone, date: Date) => zoned(zone, { month: 'short', year: 'numeric' })(date);
const yearMonthText = (zone: StudioZone, date: Date) => dateText(zone, date).split('/').reverse().slice(0, 2).join('-'); // 2026-10
const timeText = (zone: StudioZone, date: Date) => zoned(zone, { hour: 'numeric', minute: '2-digit', hour12: true })(date);

/** A number when the answer is numeric (so Excel can total it), otherwise the text. */
const numeric = (value: string) => (value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value);

/** Who fills a column decides its header colour: the system and the client's booking form (blue), the consultant (green), the client's feedback (amber). */
type Section = 'auto' | 'booking' | 'consultant' | 'feedback';
const SECTION_FILL: Record<Section, string> = { auto: 'FF0157B3', booking: 'FF0157B3', consultant: 'FF0F7B5F', feedback: 'FF633806' };

interface Column {
  header: string;
  width: number;
  fill: string;
  value: (r: Row, zone: StudioZone) => string | number;
}
const column = (section: Section, header: string, width: number, value: Column['value']): Column => ({ header, width, fill: SECTION_FILL[section], value });

const post = (r: Row, key: string) => r.ticket.postConsultationData[key] ?? '';
const minutesBooked = (r: Row) => Math.round((r.booking.endTime.getTime() - r.booking.startTime.getTime()) / 60000);

/** What a consultant-form column holds: most are the saved answer; four live elsewhere (see TICKET_FIELDS and the Fireflies link). */
const CONSULTANT_VALUES: Record<string, (r: Row) => string | number> = {
  consultation_status: (r) => STATUS_LABELS[r.ticket.status] ?? r.ticket.status,
  payment_status: (r) => PAYMENT_LABELS[r.ticket.paymentStatus] ?? '',
  time_span_minutes: (r) => (post(r, 'time_span_minutes') === '' ? minutesBooked(r) : numeric(post(r, 'time_span_minutes'))), // what the consultant wrote (0 too), else the booked length
  recording_link: (r) => post(r, 'recording_link') || r.booking.recordingLink || '',
};

// Every field has its own column: 9 filled by the system (the 8 auto-generated ones and the Ticket ID), the 17 booking-form fields,
// the 27 consultant-form fields and the 3 ratings plus Additional Suggestions of the feedback form.
export const COLUMNS: Column[] = [
  column('auto', 'Sr. No', 6, (r) => r.srNo),
  column('auto', 'Ticket ID', 16, (r) => r.ticket.ticketNumber),
  column('auto', 'Domain', 20, (r) => r.domain),
  column('auto', 'Mode of Consultation', 12, (r) => (r.booking.mode === 'online' ? 'Online' : 'Offline')),
  column('auto', 'Date', 12, (r, z) => dateText(z, r.booking.startTime)),
  column('auto', 'Month/Year', 10, (r, z) => monthText(z, r.booking.startTime)),
  column('auto', 'Time Slot', 10, (r, z) => timeText(z, r.booking.startTime)),
  column('auto', 'Coordinator Assigned', 18, (r) => r.coordinator ?? 'Unassigned'),
  column('auto', 'Year-Month', 10, (r, z) => yearMonthText(z, r.booking.startTime)),
  ...CLIENT_FIELDS.map(({ key, label, type }) => column('booking', label, 18, (r) => (key === 'employmentRange' ? numeric(clientText(r.client, key)) : type === 'tel' ? r.client.phone : clientText(r.client, key)))),
  ...DEFAULT_POST_CONSULTATION_QUESTIONS.map(({ id, label, type }) =>
    column('consultant', label, type === 'textarea' ? 30 : type === 'select' || type === 'checkbox' ? 22 : 14, CONSULTANT_VALUES[id] ?? ((r) => (type === 'number' ? numeric(post(r, id)) : post(r, id)))),
  ),
  ...FEEDBACK_FIELDS.map(({ key, label }) => column('feedback', label, 10, (r) => numeric(r.ticket.feedbackData[key] ?? ''))),
  column('feedback', FEEDBACK_COMMENTS_LABEL, 30, (r) => r.ticket.feedbackData[FEEDBACK_COMMENTS] ?? ''),
];

const HEADER = 'FF0157B3'; // the brand blue
const INK = 'FF1A1F36';
const BORDER = { style: 'thin', color: { argb: 'FFE5E7EB' } } as const;
const PREFERRED_ORDER = ['ai-consultation', 'applet-setup', 'cluster-development'];

/** One styled tab: a blue header (frozen, filterable), then one row per entry. */
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: { header: string; width: number; fill?: string }[], rows: (string | number)[][]) {
  const sheet = workbook.addWorksheet(name.replace(/[\\/?*:[\]]/g, '-').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ header, width }) => ({ header, width }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const header = sheet.getRow(1);
  header.height = 20;
  header.eachCell((cell, index) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columns[index - 1].fill ?? HEADER } };
    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle' };
    cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  });

  rows.forEach((values, index) => {
    const excelRow = sheet.addRow(values);
    excelRow.height = 18;
    excelRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index % 2 ? 'FFFFF9F9' : 'FFFFFFFF' } };
      cell.font = { size: 11, color: { argb: INK } };
      cell.alignment = { vertical: 'middle' };
      cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
    });
  });
}

export interface ExcelFilters {
  modules?: string[]; // module slugs; leave out for every module
  ids?: string[]; // ticket ids; leave out for every ticket
}

/** Tickets with what their rows need (booking, client, the coordinator's name, module), in Sr. No order. `condition` picks the tickets. */
export async function ticketRows(condition: SQL | undefined) {
  return await db
    .select({ ticket: tickets, booking: bookings, client: clients, coordinator: coordinators.name, module: modules })
    .from(tickets)
    .innerJoin(bookings, eq(tickets.bookingId, bookings.id))
    .innerJoin(clients, eq(tickets.clientId, clients.id))
    .innerJoin(modules, eq(tickets.moduleId, modules.id))
    .leftJoin(coordinators, eq(tickets.coordinatorId, coordinators.id))
    .where(condition)
    .orderBy(asc(bookings.excelRowNumber), asc(bookings.createdAt));
}

/** The workbook for the chosen modules (one tab each, even when empty), built fresh from Neon. */
export async function exportFilteredExcel(settings: AppSettings, { modules: slugs, ids }: ExcelFilters = {}) {
  const allModules = await db.select().from(modules).orderBy(asc(modules.name));
  const unknown = slugs?.find((slug) => !allModules.some((m) => m.slug === slug));
  if (unknown) throw new HttpError(400, `Unknown module: ${unknown}`);

  const chosen = allModules
    .filter((m) => !slugs || slugs.includes(m.slug))
    .sort((a, b) => (PREFERRED_ORDER.indexOf(a.slug) + 1 || 99) - (PREFERRED_ORDER.indexOf(b.slug) + 1 || 99));

  const found = chosen.length ? await ticketRows(and(inArray(tickets.moduleId, chosen.map((m) => m.id)), ids ? inArray(tickets.id, ids) : undefined)) : [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  let total = 0;
  for (const module of chosen) {
    const inModule = found.filter((f) => f.ticket.moduleId === module.id);
    // Bookings made before row numbers existed get the next free numbers, in booking order (not saved).
    let next = Math.max(0, ...inModule.map((f) => f.booking.excelRowNumber ?? 0));
    const tabRows = inModule.map((f) => ({ ...f, domain: module.name, srNo: f.booking.excelRowNumber ?? ++next }));
    total += tabRows.length;
    addSheet(workbook, module.name, COLUMNS, tabRows.map((row) => COLUMNS.map((column) => column.value(row, settings.timezone))));
  }
  return { buffer: await workbook.xlsx.writeBuffer(), tickets: total };
}

const AUDIT_COLUMNS = [
  { header: 'Timestamp', width: 22 },
  { header: 'Action', width: 24 },
  { header: 'Entity', width: 14 },
  { header: 'Entity ID', width: 38 },
  { header: 'Old Value', width: 40 },
  { header: 'New Value', width: 40 },
  { header: 'Done By', width: 20 },
  { header: 'Role', width: 12 },
];

/** Every audit log entry, newest first, as a workbook with one "Audit Logs" tab. */
export async function exportAuditExcel(settings: AppSettings) {
  const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt));
  const json = (value: unknown) => (value == null ? '' : JSON.stringify(value).slice(0, 32_000)); // a cell holds 32,767 characters at most
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  addSheet(
    workbook,
    'Audit Logs',
    AUDIT_COLUMNS,
    logs.map((log) => [
      log.createdAt ? `${dateText(settings.timezone, log.createdAt)} ${timeText(settings.timezone, log.createdAt)} ${settings.timezone.label}` : '',
      log.action,
      log.entityType,
      log.entityId ?? '',
      json(log.oldValue),
      json(log.newValue),
      log.doneByName ?? '',
      log.role ?? '',
    ]),
  );
  return { buffer: await workbook.xlsx.writeBuffer(), entries: logs.length };
}
