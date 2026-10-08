import { asc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from './_lib.js';
import { bookings, clients, coordinators, modules, tickets } from './_schema.js';
import { CLIENT_FIELDS, DEFAULT_POST_CONSULTATION_QUESTIONS, defaultPostQuestions, FEEDBACK_COMMENTS, FEEDBACK_COMMENTS_LABEL, FEEDBACK_FIELDS, PAYMENT_LABELS, STATUS_LABELS, clientText, hasOwnPostQuestions, type FormField, type StudioZone } from '../src/types/index.js';

/**
 * What an Excel row of a ticket holds, column by column (no Excel library in here: the booking, ticket and client functions all load this file).
 * The download file built from it is _excel_file.ts; the studio's own live workbook on SharePoint is kept up to date by _live_excel.ts.
 * The only thing kept in the database is bookings.excel_row_number: the booking's Sr. No in its module's tab, assigned when it is booked.
 */

/** SQL for the next Sr. No in a module's tab; used as the excel_row_number when a booking is inserted. */
export const nextRowNumber = (moduleId: string) =>
  sql<number>`(select coalesce(max(${bookings.excelRowNumber}), 0) + 1 from ${bookings} where ${bookings.moduleId} = ${moduleId})`;

/** The headers other code needs to find: the ticket number, and the columns that hold when and how a session happened. */
export const FIELD = { ticket: 'Ticket ID', domain: 'Domain', mode: 'Mode of Consultation', date: 'Date', time: 'Time Slot', coordinator: 'Coordinator Assigned' } as const;

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
export const dateText = (zone: StudioZone, date: Date) => {
  const [month, day, year] = zoned(zone, { day: '2-digit', month: '2-digit', year: 'numeric' })(date).split('/'); // MM/DD/YYYY
  return `${day}/${month}/${year}`; // DD/MM/YYYY
};
const monthText = (zone: StudioZone, date: Date) => zoned(zone, { month: 'short', year: 'numeric' })(date);
const yearMonthText = (zone: StudioZone, date: Date) => dateText(zone, date).split('/').reverse().slice(0, 2).join('-'); // 2026-10
export const timeText = (zone: StudioZone, date: Date) => zoned(zone, { hour: 'numeric', minute: '2-digit', hour12: true })(date);

/** A number when the answer is numeric (so Excel can total it), otherwise the text. */
const numeric = (value: string) => (value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value);

/** Who fills a column decides its header colour: the system and the client's booking form (blue), the consultant (green), the client's feedback (amber). */
type Section = 'auto' | 'booking' | 'consultant' | 'feedback';
const SECTION_FILL: Record<Section, string> = { auto: 'FF0157B3', booking: 'FF0157B3', consultant: 'FF0F7B5F', feedback: 'FF633806' };

export interface Column {
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
// the consultant-form fields (27 by default) and the 3 ratings plus Additional Suggestions of the feedback form.
function buildColumns(consultantForm: FormField[]): Column[] {
  return [
    column('auto', 'Sr. No', 6, (r) => r.srNo),
    column('auto', FIELD.ticket, 16, (r) => r.ticket.ticketNumber),
    column('auto', FIELD.domain, 20, (r) => r.domain),
    column('auto', FIELD.mode, 12, (r) => (r.booking.mode === 'online' ? 'Online' : 'Offline')),
    column('auto', FIELD.date, 12, (r, z) => dateText(z, r.booking.startTime)),
    column('auto', 'Month/Year', 10, (r, z) => monthText(z, r.booking.startTime)),
    column('auto', FIELD.time, 10, (r, z) => timeText(z, r.booking.startTime)),
    column('auto', FIELD.coordinator, 18, (r) => r.coordinator ?? 'Unassigned'),
    column('auto', 'Year-Month', 10, (r, z) => yearMonthText(z, r.booking.startTime)),
    ...CLIENT_FIELDS.map(({ key, label, type }) => column('booking', label, 18, (r) => (key === 'employmentRange' ? numeric(clientText(r.client, key)) : type === 'tel' ? r.client.phone : clientText(r.client, key)))),
    ...consultantForm.map(({ id, label, type }) =>
      column('consultant', label, type === 'textarea' ? 30 : type === 'select' || type === 'checkbox' ? 22 : 14, CONSULTANT_VALUES[id] ?? ((r) => (type === 'number' ? numeric(post(r, id)) : post(r, id)))),
    ),
    ...FEEDBACK_FIELDS.map(({ key, label }) => column('feedback', label, 10, (r) => numeric(r.ticket.feedbackData[key] ?? ''))),
    column('feedback', FEEDBACK_COMMENTS_LABEL, 30, (r) => r.ticket.feedbackData[FEEDBACK_COMMENTS] ?? ''),
  ];
}

export const COLUMNS = buildColumns(DEFAULT_POST_CONSULTATION_QUESTIONS);
const own = new Map<string, Column[]>();
/** The columns of a module's tab: the same ones, with the module's own consultant form in the middle when it has one (Applet Setup). */
export function columnsFor(slug: string) {
  if (!hasOwnPostQuestions(slug)) return COLUMNS;
  if (!own.has(slug)) own.set(slug, buildColumns(defaultPostQuestions(slug)));
  return own.get(slug)!;
}

// ---------- the studio's own workbook: its headers against ours ----------

/** A header with capitals and spaces taken out: how headers are compared. */
export const norm = (text: string) => text.toUpperCase().replace(/\s+/g, '');

/** Headers as the workbook spells them (typos included) -> the download column that holds the same thing. Others match by their own name. */
const ALIASES: Record<string, string> = {
  'SR NO': 'Sr. No',
  'TICKET': 'Ticket ID',
  'CONTACT': 'Contact / Phone',
  'PAYMENT': 'Payment Status',
  'CONSLTATION STATUS': 'Consultation Status',
  'HOD/COORDINATOR ASSIGNED': 'Coordinator Assigned',
  'MEMBER/ NON MEMBER': 'Member / Non-Member',
  'MODE OF APPLET SETUP': 'Mode of Consultation',
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

/** What a header is called in the download: its alias when the workbook spells it another way, else itself (both compared with `norm`). */
export const downloadName = (header: string) => aliases.get(norm(header)) ?? norm(header);

/** How a sheet's headers map to the columns of its module's tab (a module's own consultant form gives its own columns, e.g. Applet Setup's). */
export type ColumnOf = (header: string) => Column | undefined;
const mappings = new Map<string, ColumnOf>();
export function mappingOf(slug: string): ColumnOf {
  let mapping = mappings.get(slug);
  if (!mapping) {
    const byName = new Map(columnsFor(slug).map((column) => [norm(column.header), column]));
    mapping = (header) => byName.get(downloadName(header));
    mappings.set(slug, mapping);
  }
  return mapping;
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
