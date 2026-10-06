import ExcelJS from 'exceljs';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, HttpError } from './_lib.js';
import { auditLogs, bookings, clients, coordinators, modules, tickets } from './_schema.js';
import { FEEDBACK_FIELDS, PAYMENT_LABELS, STATUS_LABELS, type AppSettings, type StudioZone } from '../src/types/index.js';

/**
 * The Excel file is never stored. Neon is the source of truth and every download is generated fresh from it, so
 * post-consultation notes, status changes, feedback and meeting links are always current. The only thing kept is
 * bookings.excel_row_number: the booking's Sr. No in its module's tab (sheet row = Sr. No + 1), assigned when it is booked.
 */

/** SQL for the next Sr. No in a module's tab; used as the excel_row_number when a booking is inserted. */
export const nextRowNumber = (moduleId: string) =>
  sql<number>`(select coalesce(max(${bookings.excelRowNumber}), 0) + 1 from ${bookings} where ${bookings.moduleId} = ${moduleId})`;

interface Row {
  srNo: number;
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
const timeText = (zone: StudioZone, date: Date) => zoned(zone, { hour: 'numeric', minute: '2-digit', hour12: true })(date);

const post = (r: Row, key: string) => r.ticket.postConsultationData[key] ?? '';
/** A number when the answer is numeric (so Excel can total it), otherwise the text. */
const numeric = (value: string) => (value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value);
const rating = (r: Row, key: string) => numeric(r.ticket.feedbackData[key] ?? '');
const feedback = (index: number) => (r: Row) => rating(r, FEEDBACK_FIELDS[index].key);

// The 38 columns, A to AL, in this order.
const COLUMNS: { header: string; width: number; value: (r: Row, zone: StudioZone) => string | number }[] = [
  { header: 'Sr. No', width: 6, value: (r) => r.srNo },
  { header: 'Ticket ID', width: 16, value: (r) => r.ticket.ticketNumber },
  { header: 'Company Name', width: 22, value: (r) => r.client.companyName },
  { header: 'UDYAM No', width: 18, value: (r) => r.client.udyamNo ?? '' },
  { header: 'Person Name', width: 18, value: (r) => r.client.personName },
  { header: 'Contact (Phone)', width: 14, value: (r) => r.client.phone },
  { header: 'Email', width: 24, value: (r) => r.client.email },
  { header: 'Payment', width: 10, value: (r) => PAYMENT_LABELS[r.ticket.paymentStatus] ?? '' }, // set by an admin on the ticket
  { header: 'Mode of Consultation', width: 12, value: (r) => (r.booking.mode === 'online' ? 'Online' : 'Offline') },
  { header: 'Date (DD/MM/YYYY)', width: 12, value: (r, z) => dateText(z, r.booking.startTime) },
  { header: 'Month/Year', width: 10, value: (r, z) => monthText(z, r.booking.startTime) },
  { header: 'Time Slot', width: 10, value: (r, z) => timeText(z, r.booking.startTime) },
  { header: 'Consultation Status', width: 14, value: (r) => STATUS_LABELS[r.ticket.status] ?? r.ticket.status },
  { header: 'Coordinator Assigned', width: 18, value: (r) => r.coordinator ?? 'Unassigned' },
  { header: 'RAMP or Non-RAMP', width: 10, value: (r) => post(r, 'ramp_type') },
  { header: 'Member/Non-Member', width: 12, value: (r) => (r.client.isMember ? 'Member' : 'Non-Member') },
  { header: 'Acquisition From', width: 14, value: (r) => r.client.acquisitionFrom ?? '' },
  { header: 'Meeting Query', width: 30, value: (r) => post(r, 'meeting_query') },
  { header: 'Meeting Solution', width: 30, value: (r) => post(r, 'meeting_solution') },
  { header: 'Time Span', width: 10, value: (r) => `${Math.round((r.booking.endTime.getTime() - r.booking.startTime.getTime()) / 60000)} min` },
  { header: FEEDBACK_FIELDS[0].label, width: 10, value: feedback(0) },
  { header: FEEDBACK_FIELDS[1].label, width: 10, value: feedback(1) },
  { header: FEEDBACK_FIELDS[2].label, width: 10, value: feedback(2) },
  { header: FEEDBACK_FIELDS[3].label, width: 10, value: feedback(3) },
  { header: 'Value addition notes', width: 30, value: (r) => post(r, 'value_addition') },
  { header: 'Additional Suggestions', width: 30, value: (r) => post(r, 'additional_suggestions') },
  { header: 'Industry/Sector', width: 18, value: (r) => r.client.industry ?? '' },
  { header: 'Scale', width: 10, value: (r) => r.client.scale ?? '' },
  { header: 'Job Title', width: 16, value: (r) => r.client.jobTitle ?? '' },
  { header: 'Google Meet Link', width: 20, value: (r) => r.booking.meetingLink ?? '' },
  { header: 'Testimonial Link', width: 20, value: (r) => post(r, 'testimonial_link') },
  { header: 'Interaction Status', width: 14, value: (r) => post(r, 'interaction_status') },
  { header: 'Active User', width: 10, value: (r) => post(r, 'active_user') },
  { header: 'Time Cost (hours)', width: 10, value: (r) => numeric(post(r, 'time_cost_hours')) },
  { header: 'Money Cost (INR)', width: 12, value: (r) => numeric(post(r, 'money_cost_inr')) },
  { header: 'Membership ID', width: 14, value: (r) => r.client.membershipId ?? '' },
  { header: 'AI Implementation Level', width: 16, value: (r) => post(r, 'ai_level') },
  { header: 'AI Use Description', width: 30, value: (r) => post(r, 'ai_use_description') },
];

const HEADER = 'FF0157B3'; // the brand blue
const INK = 'FF1A1F36';
const BORDER = { style: 'thin', color: { argb: 'FFE5E7EB' } } as const;
const PREFERRED_ORDER = ['ai-consultation', 'applet-setup', 'cluster-development'];

/** One styled tab: a blue header (frozen, filterable), then one row per entry. */
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: { header: string; width: number }[], rows: (string | number)[][]) {
  const sheet = workbook.addWorksheet(name.replace(/[\\/?*:[\]]/g, '-').slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(({ header, width }) => ({ header, width }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const header = sheet.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER } };
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

/** The workbook for the chosen modules (one tab each, even when empty), built fresh from Neon. */
export async function exportFilteredExcel(settings: AppSettings, { modules: slugs, ids }: ExcelFilters = {}) {
  const allModules = await db.select().from(modules).orderBy(asc(modules.name));
  const unknown = slugs?.find((slug) => !allModules.some((m) => m.slug === slug));
  if (unknown) throw new HttpError(400, `Unknown module: ${unknown}`);

  const chosen = allModules
    .filter((m) => !slugs || slugs.includes(m.slug))
    .sort((a, b) => (PREFERRED_ORDER.indexOf(a.slug) + 1 || 99) - (PREFERRED_ORDER.indexOf(b.slug) + 1 || 99));

  const found = chosen.length
    ? await db
        .select({ ticket: tickets, booking: bookings, client: clients, coordinator: coordinators.name })
        .from(tickets)
        .innerJoin(bookings, eq(tickets.bookingId, bookings.id))
        .innerJoin(clients, eq(tickets.clientId, clients.id))
        .leftJoin(coordinators, eq(tickets.coordinatorId, coordinators.id))
        .where(and(inArray(tickets.moduleId, chosen.map((m) => m.id)), ids ? inArray(tickets.id, ids) : undefined))
        .orderBy(asc(bookings.excelRowNumber), asc(bookings.createdAt))
    : [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  let total = 0;
  for (const module of chosen) {
    const inModule = found.filter((f) => f.ticket.moduleId === module.id);
    // Bookings made before row numbers existed get the next free numbers, in booking order (not saved).
    let next = Math.max(0, ...inModule.map((f) => f.booking.excelRowNumber ?? 0));
    const tabRows = inModule.map((f) => ({ ...f, srNo: f.booking.excelRowNumber ?? ++next }));
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
