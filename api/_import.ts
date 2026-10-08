import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { studioTime } from './_availability.js';
import { companyCoordinatorOf, companyIdOf } from './_companies.js';
import { downloadName, FIELD, norm } from './_excel.js';
import { updateSheet } from './_live_excel.js';
import { audit, db, HttpError, loadSettings, type AuthUser } from './_lib.js';
import { bookings, clients, companies, coordinators, slotConfig, tickets } from './_schema.js';
import {
  CLIENT_FIELDS,
  EMAIL_PATTERN,
  FEEDBACK_COMMENTS,
  FEEDBACK_COMMENTS_LABEL,
  FEEDBACK_FIELDS,
  normalizePhone,
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  STATUS_LABELS,
  TICKET_FIELDS,
  TICKET_STATUSES,
  type BookingMode,
  type BookingStatus,
  type FormField,
  type ImportReport,
  type ImportTarget,
  type InternalNote,
  type PaymentStatus,
  type TicketStatus,
} from '../src/types/index.js';

/**
 * Bulk adding tickets from a file (the previous software's export, or the template). The file's columns are matched to the fields below (the
 * same header matching as the live Excel sheet, so a sheet in the studio's own layout needs no matching at all), every row is checked, and the
 * rows that pass become a client (matched by email), a booking and a ticket each. Nothing is emailed and no calendar event is made: these are
 * sessions that already happened (or were arranged elsewhere). A row whose client, module and start time are already in the app is skipped,
 * so the same file can be imported twice safely.
 */

const MAX_ERRORS = 100;
const REQUIRED_CLIENT: readonly string[] = ['companyName', 'personName', 'email', 'phone'];

// ---------- what a column can be ----------

/** The fields a module's file can fill, in the order of the template. */
export function importTargets(postQuestions: FormField[]): ImportTarget[] {
  const targets: ImportTarget[] = [
    { label: FIELD.ticket, required: false },
    { label: FIELD.date, required: true },
    { label: FIELD.time, required: true },
    { label: FIELD.mode, required: false },
    { label: FIELD.coordinator, required: false },
    ...CLIENT_FIELDS.map(({ key, label }) => ({ label, required: REQUIRED_CLIENT.includes(key) })),
    ...postQuestions.map(({ label }) => ({ label, required: false })),
    ...FEEDBACK_FIELDS.map(({ label }) => ({ label, required: false })),
    { label: FEEDBACK_COMMENTS_LABEL, required: false },
  ];
  const seen = new Set<string>();
  return targets.filter(({ label }) => !seen.has(label) && seen.add(label)); // a label means one field: the first wins
}

// Other names a file may use, besides the live sheet's (see ALIASES in _excel.ts).
const importAliases = new Map(
  Object.entries({
    EMAIL: 'Email ID', 'E-MAIL': 'Email ID', 'EMAIL ADDRESS': 'Email ID', 'EMAILID': 'Email ID',
    PHONE: 'Contact / Phone', MOBILE: 'Contact / Phone', 'MOBILE NO': 'Contact / Phone', 'PHONE NO': 'Contact / Phone', 'CONTACT NO': 'Contact / Phone', 'CONTACT NUMBER': 'Contact / Phone', CONTACT: 'Contact / Phone',
    COMPANY: 'Company Name', ORGANISATION: 'Company Name', ORGANIZATION: 'Company Name', 'NAME OF COMPANY': 'Company Name', 'FIRM NAME': 'Company Name',
    NAME: 'Person Name', 'CONTACT PERSON': 'Person Name', 'CLIENT NAME': 'Person Name', 'NAME OF PERSON': 'Person Name', PERSON: 'Person Name',
    'DATE OF CONSULTATION': 'Date', 'SESSION DATE': 'Date', 'BOOKING DATE': 'Date', 'DATE OF SESSION': 'Date', 'DATE OF MEETING': 'Date',
    TIME: 'Time Slot', 'START TIME': 'Time Slot', SLOT: 'Time Slot', 'SESSION TIME': 'Time Slot',
    MODE: 'Mode of Consultation', 'MODE OF MEETING': 'Mode of Consultation',
    COORDINATOR: 'Coordinator Assigned', 'ASSIGNED TO': 'Coordinator Assigned', 'ASSIGNED COORDINATOR': 'Coordinator Assigned', CONSULTANT: 'Coordinator Assigned',
    'TICKET NO': 'Ticket ID', 'TICKET NUMBER': 'Ticket ID', 'OLD TICKET': 'Ticket ID', ID: 'Ticket ID',
    STATUS: 'Consultation Status', 'TICKET STATUS': 'Consultation Status',
    MEMBER: 'Member / Non-Member', 'MEMBER TYPE': 'Member / Non-Member',
    DESIGNATION: 'Job Title', SECTOR: 'Sector',
  }).map(([header, label]) => [norm(header), norm(label)]),
);

/** For each column header of the file, the target it probably is (null when none fits); a target is given to the first column that fits it. */
export function suggestMapping(headers: string[], targets: ImportTarget[]) {
  const byName = new Map(targets.map(({ label }) => [norm(label), label]));
  const used = new Set<string>();
  return headers.map((header) => {
    const label = byName.get(importAliases.get(norm(header)) ?? downloadName(header));
    if (!label || used.has(label)) return null;
    used.add(label);
    return label;
  });
}

/** What to write in each column of the template ("How to fill" tab), by the column's label. */
export function guideRows(postQuestions: FormField[]): [string, string, string][] {
  const note = (label: string): string => {
    if (label === FIELD.ticket) return "The previous software's ticket number. It is kept in a note on the ticket; every ticket here gets a new number.";
    if (label === FIELD.date) return 'The day of the session: 12/10/2026 (day first), 2026-10-12 or 12 Oct 2026.';
    if (label === FIELD.time) return 'When the session started: 10:30 AM or 14:00.';
    if (label === FIELD.mode) return 'Online or Offline. Left empty it counts as Online.';
    if (label === FIELD.coordinator) return "A coordinator's name or email as it is in this app. Empty or not found: the ticket is left unassigned.";
    const client = CLIENT_FIELDS.find((f) => f.label === label);
    if (client?.type === 'member') return 'Member or Non-Member.';
    if (client?.options) return `One of: ${client.options.join(' | ')}. Anything else is kept as written.`;
    if (client?.key === 'phone') return 'A mobile number (10 digits; +91 or 0 in front is fine).';
    if (client?.key === 'employmentRange') return 'A whole number.';
    if (client) return client.required ? 'Text.' : 'Text (optional).';
    const rating = FEEDBACK_FIELDS.find((f) => f.label === label);
    if (rating) return 'The rating the client gave, 1 to 5. Empty if they did not rate.';
    if (label === FEEDBACK_COMMENTS_LABEL) return "The client's written feedback.";
    const question = postQuestions.find((q) => q.label === label);
    if (question?.id === 'consultation_status') return `One of: ${TICKET_STATUSES.map((s) => STATUS_LABELS[s]).join(' | ')}. Empty: Completed for a past session, Scheduled for a future one.`;
    if (question?.id === 'payment_status') return `One of: ${PAYMENT_STATUSES.map((s) => PAYMENT_LABELS[s]).join(' | ')}. Empty: Unpaid.`;
    if (question?.options?.length) return `One of: ${question.options.join(' | ')}${question.type === 'checkbox' ? ' (several: separate with a comma)' : ''}.`;
    if (question?.type === 'number') return 'A number.';
    if (question?.type === 'url') return 'A web address.';
    return 'Text (optional).';
  };
  return importTargets(postQuestions).map(({ label, required }) => [label, required ? 'Yes' : 'No', note(label)]);
}

// ---------- reading values ----------

class RowError extends Error {}
function bad(message: string): never {
  throw new RowError(message);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "10:30 AM", "10.30 pm", "2 PM", "14:00", "14:00:00" or a fraction of a day (Excel's 0.4375) as HH:mm; null when it is none of these. */
export function parseTime(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/^0?\.\d+$/.test(t)) {
    const minutes = Math.round(Number(t) * 1440);
    return minutes < 1440 ? `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` : null;
  }
  const m = /^(\d{1,2})(?:[:.h](\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?$/.exec(t);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2] ?? 0);
  if (m[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (m[3] === 'p' ? 12 : 0);
  }
  return hours > 23 || minutes > 59 ? null : `${pad(hours)}:${pad(minutes)}`;
}

/**
 * The day (and the time, when the text had one) from the ways files write a date: 12/10/2026 (day first; 10/13/2026 is read as month first
 * because 13 cannot be a month), 2026-10-12, 12 Oct 2026, Oct 12, 2026 or Excel's day number (45577).
 */
export function parseDate(text: string): { date: string; time?: string } | null {
  const t = text.trim();
  let y: number, mo: number, d: number, rest = '';
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(.*))?$/.exec(t))) [y, mo, d, rest] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ''];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[,\sT]+(.*))?$/.exec(t))) {
    [d, mo, y, rest] = [Number(m[1]), Number(m[2]), m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), m[4] ?? ''];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})\.?,?[\s-]+(\d{4})(?:[,\sT]+(.*))?$/i.exec(t)) && MONTHS.includes(m[2].slice(0, 3).toLowerCase())) {
    [d, mo, y, rest] = [Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, Number(m[3]), m[4] ?? ''];
  } else if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:[,\sT]+(.*))?$/i.exec(t)) && MONTHS.includes(m[1].slice(0, 3).toLowerCase())) {
    [d, mo, y, rest] = [Number(m[2]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[3]), m[4] ?? ''];
  } else if (/^\d+(\.\d+)?$/.test(t) && Number(t) > 20_000 && Number(t) < 80_000) {
    const at = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t) * 86_400_000));
    [y, mo, d, rest] = [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate(), Number(t) % 1 ? `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}` : ''];
  } else return null;

  const date = `${y}-${pad(mo)}-${pad(d)}`;
  if (y < 1990 || y > 2100 || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || !new Date(`${date}T00:00:00Z`).toISOString().startsWith(date)) return null;
  return { date, time: (rest && parseTime(rest)) || undefined };
}

const STATUS_BY_TEXT = new Map<string, TicketStatus>(TICKET_STATUSES.flatMap((s) => [[STATUS_LABELS[s].toLowerCase(), s], [s, s], [s.replace('_', ' '), s]] as [string, TicketStatus][]));
const pickOption = (value: string, options?: readonly string[]) => options?.find((o) => o.toLowerCase() === value.toLowerCase()) ?? value;

// ---------- one row ----------

interface Draft {
  row: number;
  ticketNo: string;
  date: string;
  time: string;
  mode: string;
  coordinator: string;
  client: Record<string, string>;
  post: Record<string, string>;
  feedback: Record<string, string>;
}

/** What each label does with the text of its cell. */
function fieldsOf(postQuestions: FormField[]) {
  const fields = new Map<string, (d: Draft, value: string) => void>([
    [FIELD.ticket, (d, v) => (d.ticketNo = v)],
    [FIELD.date, (d, v) => (d.date = v)],
    [FIELD.time, (d, v) => (d.time = v)],
    [FIELD.mode, (d, v) => (d.mode = v)],
    [FIELD.coordinator, (d, v) => (d.coordinator = v)],
  ]);
  const add = (label: string, apply: (d: Draft, value: string) => void) => fields.has(label) || fields.set(label, apply);
  for (const { key, label } of CLIENT_FIELDS) add(label, (d, v) => (d.client[key] = v));
  for (const { id, label } of postQuestions) add(label, (d, v) => (d.post[id] = v));
  for (const { key, label } of FEEDBACK_FIELDS) add(label, (d, v) => (d.feedback[key] = v));
  add(FEEDBACK_COMMENTS_LABEL, (d, v) => (d.feedback[FEEDBACK_COMMENTS] = v));
  return fields;
}

interface Context {
  tz: string;
  now: Date;
  slotMinutes: number;
  postQuestions: FormField[];
  coordinators: { id: string; name: string; email: string }[];
}

/** A client as it is saved: the first five are required, the rest are kept as written (null when the cell was empty). */
interface ClientValues {
  companyName: string;
  personName: string;
  email: string;
  phone: string;
  isMember: boolean;
  membershipId: string | null;
  jobTitle: string | null;
  udyamNo: string | null;
  district: string | null;
  subSector: string | null;
  employmentRange: number | null;
  scale: string | null;
  industry: string | null;
  acquisitionFrom: string | null;
  gender: string | null;
  category: string | null;
  onlinePresence: string | null;
}

interface Prepared {
  row: number;
  client: ClientValues;
  start: Date;
  end: Date;
  mode: BookingMode;
  coordinatorId: string | null;
  missingCoordinator: string;
  status: TicketStatus;
  payment: PaymentStatus;
  post: Record<string, string>;
  feedback: Record<string, string>;
  note: string;
}

/** The client's details from a row: the four contact details are required, everything else is kept as written. */
function clientOf(d: Draft): ClientValues {
  const text = (key: string) => d.client[key] ?? '';
  const email = text('email');
  if (!text('companyName')) bad('Company Name is missing');
  if (!text('personName')) bad('Person Name is missing');
  if (!email) bad('Email ID is missing');
  if (!EMAIL_PATTERN.test(email)) bad(`"${email}" is not a valid email address`);
  if (!text('phone')) bad('Contact / Phone is missing');
  const employment = text('employmentRange');
  if (employment && !/^\d{1,7}$/.test(employment)) bad(`Employment Range "${employment}" must be a whole number`);
  const option = (key: string) => (pickOption(text(key), CLIENT_FIELDS.find((f) => f.key === key)?.options) || null);
  const isMember = /^(member|yes|y|true|1)$/i.test(text('isMember')) || (!text('isMember') && Boolean(text('membershipId')));
  return {
    companyName: text('companyName'),
    personName: text('personName'),
    email,
    phone: normalizePhone(text('phone')) ?? text('phone'),
    isMember,
    membershipId: (isMember && text('membershipId')) || null,
    jobTitle: text('jobTitle') || null,
    udyamNo: text('udyamNo') || null,
    district: text('district') || null,
    subSector: text('subSector') || null,
    employmentRange: employment ? Number(employment) : null,
    scale: option('scale'),
    industry: option('industry'),
    acquisitionFrom: option('acquisitionFrom'),
    gender: option('gender'),
    category: option('category'),
    onlinePresence: option('onlinePresence'),
  };
}

/** Checks one row and turns it into what will be saved; throws a RowError saying what is wrong with it. */
function prepare(d: Draft, ctx: Context): Prepared {
  const client = clientOf(d);

  const day = d.date ? parseDate(d.date) : bad('Date is missing');
  if (!day) bad(`"${d.date}" is not a date (write it like 12/10/2026)`);
  const time = d.time ? parseTime(d.time) : day.time;
  if (!time) return bad(d.time ? `"${d.time}" is not a time (write it like 10:30 AM)` : 'Time Slot is missing (write it like 10:30 AM)');
  const start = new Date(studioTime(day.date, time, ctx.tz));

  const span = Number(d.post.time_span_minutes);
  const end = new Date(start.getTime() + (Number.isFinite(span) && span >= 5 && span <= 1440 ? span : ctx.slotMinutes) * 60_000);

  const modeText = d.mode.toLowerCase();
  const mode: BookingMode = !modeText ? 'online' : /offline|in.?person|physical|walk|visit|studio/.test(modeText) ? 'offline' : /online|virtual|meet|zoom|video|call/.test(modeText) ? 'online' : bad(`Mode "${d.mode}" is not Online or Offline`);

  const who = d.coordinator.toLowerCase().replace(/\s+/g, ' ');
  const coordinator = !who || who === 'unassigned' || who === '-' ? undefined : ctx.coordinators.find((c) => c.email.toLowerCase() === who || c.name.toLowerCase() === who);
  const missingCoordinator = who && who !== 'unassigned' && who !== '-' && !coordinator ? d.coordinator : '';

  const statusText = (d.post.consultation_status ?? '').toLowerCase();
  const status = !statusText ? (start < ctx.now ? 'completed' : 'new') : STATUS_BY_TEXT.get(statusText) ?? bad(`Status "${d.post.consultation_status}" is not one of ${TICKET_STATUSES.map((s) => STATUS_LABELS[s]).join(', ')}`);
  const paymentText = (d.post.payment_status ?? '').toLowerCase();
  const payment = !paymentText ? 'unpaid' : PAYMENT_STATUSES.find((p) => p === paymentText || PAYMENT_LABELS[p].toLowerCase() === paymentText) ?? bad(`Payment "${d.post.payment_status}" is not Paid, Unpaid or Waived`);

  const post: Record<string, string> = {};
  for (const { id, options } of ctx.postQuestions) if (d.post[id] && !(id in TICKET_FIELDS)) post[id] = pickOption(d.post[id], options).slice(0, 5000);
  const feedback: Record<string, string> = {};
  for (const { key, label } of FEEDBACK_FIELDS) {
    if (!d.feedback[key]) continue;
    const stars = Number(d.feedback[key]);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) bad(`"${label}" must be a whole number from 1 to 5, not "${d.feedback[key]}"`);
    feedback[key] = String(stars);
  }
  if (d.feedback[FEEDBACK_COMMENTS]) feedback[FEEDBACK_COMMENTS] = d.feedback[FEEDBACK_COMMENTS].slice(0, 5000);

  const note = [`Imported from the previous software${d.ticketNo ? ` (its ticket number: ${d.ticketNo})` : ''}.`, missingCoordinator && `Coordinator in the file: ${missingCoordinator} (not found here, so the ticket is unassigned).`].filter(Boolean).join(' ');
  return { row: d.row, client, start, end, mode, coordinatorId: coordinator?.id ?? null, missingCoordinator, status, payment, post, feedback, note };
}

// ---------- the file as a table ----------

/** The header row (the first of the first ten with at least two filled cells) and the rows under it, each as long as the header; row numbers count as Excel does. */
export function splitTable(table: string[][]) {
  const filled = (row: string[]) => row.filter((cell) => cell.trim()).length;
  const at = table.slice(0, 10).findIndex((row) => filled(row) >= 2);
  if (at < 0) throw new HttpError(400, 'No header row found: the first rows of the sheet need at least two column names');
  const headers = table[at].map((cell) => cell.trim());
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  const rows = table.slice(at + 1).map((row) => headers.map((_, i) => row[i] ?? ''));
  while (rows.length && rows[rows.length - 1].every((cell) => !cell.trim())) rows.pop();
  return { headers: headers.map((header, i) => header || `Column ${i + 1}`), rows, firstRow: at + 2 };
}

// ---------- the whole request ----------

export interface ImportRequest {
  user: AuthUser;
  module: { id: string; name: string };
  postQuestions: FormField[];
  rows: string[][]; // text of every cell
  mapping: (string | null)[]; // per column of the rows: the target label, or null to ignore the column
  firstRow: number; // the file's row number of rows[0] (messages say "row 5")
  dryRun: boolean;
  file: string;
}

export async function importRows({ user, module, postQuestions, rows, mapping, firstRow, dryRun, file }: ImportRequest): Promise<ImportReport> {
  const fields = fieldsOf(postQuestions);
  const columns = mapping.map((label) => (label ? fields.get(label) : undefined));
  const report: ImportReport = { ready: 0, created: 0, duplicates: 0, failed: 0, errors: [], warnings: [], tickets: [] };

  const [settings, coordinatorRows, [config]] = await Promise.all([
    loadSettings(),
    db.select({ id: coordinators.id, name: coordinators.name, email: coordinators.email }).from(coordinators),
    db.select({ slotIncrement: slotConfig.slotIncrement }).from(slotConfig).where(eq(slotConfig.moduleId, module.id)),
  ]);
  const ctx: Context = { tz: settings.timezone.tz, now: new Date(), slotMinutes: config?.slotIncrement ?? 60, postQuestions, coordinators: coordinatorRows };

  const prepared: Prepared[] = [];
  rows.forEach((cells, index) => {
    if (cells.every((cell) => !cell.trim())) return; // an empty row in the middle of a sheet is just a gap
    const draft: Draft = { row: firstRow + index, ticketNo: '', date: '', time: '', mode: '', coordinator: '', client: {}, post: {}, feedback: {} };
    columns.forEach((apply, column) => apply?.(draft, (cells[column] ?? '').trim()));
    try {
      prepared.push(prepare(draft, ctx));
    } catch (e) {
      if (!(e instanceof RowError)) throw e;
      report.failed++;
      if (report.errors.length < MAX_ERRORS) report.errors.push({ row: draft.row, message: e.message });
    }
  });

  // A session already in the app (same client, module and start time, cancelled or not) is not added again; nor is one twice in the file.
  const emails = [...new Set(prepared.map((p) => p.client.email.toLowerCase()))];
  const known = emails.length ? await db.select().from(clients).where(inArray(sql`lower(${clients.email})`, emails)).orderBy(clients.createdAt) : [];
  const byEmail = new Map<string, (typeof known)[number]>();
  for (const c of known) if (!byEmail.has(c.email.toLowerCase())) byEmail.set(c.email.toLowerCase(), c);
  const sessions = byEmail.size ? await db.select({ clientId: bookings.clientId, start: bookings.startTime }).from(bookings).where(and(eq(bookings.moduleId, module.id), inArray(bookings.clientId, [...byEmail.values()].map((c) => c.id)))) : [];
  const taken = new Set(sessions.map((s) => `${s.clientId}|${s.start.getTime()}`));
  const fresh: Prepared[] = [];
  for (const p of prepared) {
    const email = p.client.email.toLowerCase();
    const key = `${byEmail.get(email)?.id ?? email}|${p.start.getTime()}`;
    if (taken.has(key)) report.duplicates++;
    else fresh.push(p), taken.add(key);
  }
  report.ready = fresh.length;
  const missing = new Map<string, number>();
  for (const p of fresh) if (p.missingCoordinator) missing.set(p.missingCoordinator, (missing.get(p.missingCoordinator) ?? 0) + 1);
  for (const [name, n] of missing) report.warnings.push(`Coordinator "${name}" is not in this app: ${n} ${n === 1 ? 'ticket is' : 'tickets are'} left unassigned. Add them under Coordinators first to keep it.`);
  if (dryRun || !fresh.length) return report;

  // One request writes the whole chunk or none of it.
  const [{ n: last }] = await db.select({ n: sql<number>`coalesce(max(${bookings.excelRowNumber}), 0)::int` }).from(bookings).where(eq(bookings.moduleId, module.id));
  const newClients = new Map<string, string>(); // email -> the id of the client created for it
  const clientRows: (Omit<typeof clients.$inferInsert, 'companyId' | 'assignedCoordinatorId'> & { companyId: SQL; assignedCoordinatorId: SQL })[] = []; // the company is looked up by SQL, in the same request that creates it
  const bookingRows: (typeof bookings.$inferInsert)[] = [];
  const ticketRows: (typeof tickets.$inferInsert)[] = [];
  fresh.forEach((p, index) => {
    const email = p.client.email.toLowerCase();
    let clientId = byEmail.get(email)?.id ?? newClients.get(email);
    if (!clientId) {
      clientId = crypto.randomUUID();
      newClients.set(email, clientId);
      clientRows.push({ id: clientId, ...p.client, companyId: companyIdOf(p.client.companyName), assignedCoordinatorId: companyCoordinatorOf(p.client.companyName) });
    }
    const bookingId = crypto.randomUUID();
    const bookingStatus: BookingStatus = p.status === 'cancelled' || p.status === 'completed' ? p.status : 'scheduled';
    const notes: InternalNote[] = [{ text: p.note, author: user.name, at: new Date().toISOString() }];
    bookingRows.push({ id: bookingId, moduleId: module.id, clientId, coordinatorId: p.coordinatorId, startTime: p.start, endTime: p.end, mode: p.mode, excelRowNumber: last + index + 1, status: bookingStatus, createdBy: 'admin', reminderSent: true, meetLinkFailedNotified: true });
    ticketRows.push({ id: crypto.randomUUID(), bookingId, moduleId: module.id, clientId, coordinatorId: p.coordinatorId, status: p.status, paymentStatus: p.payment, postConsultationData: p.post, feedbackData: p.feedback, internalNotes: notes });
  });
  const companyNames = [...new Map(clientRows.map((c) => [c.companyName.toLowerCase(), c.companyName])).values()];
  const writes = [
    ...(companyNames.length ? [db.insert(companies).values(companyNames.map((name) => ({ name, nameNormalized: sql`normalize_company_name(${name})` }))).onConflictDoNothing()] : []),
    ...(clientRows.length ? [db.insert(clients).values(clientRows)] : []),
    db.insert(bookings).values(bookingRows),
    db.insert(tickets).values(ticketRows).returning({ id: tickets.id, ticketNumber: tickets.ticketNumber }),
  ];
  const results = (await db.batch(writes as unknown as [(typeof writes)[0], ...(typeof writes)[number][]])) as unknown as { id: string; ticketNumber: string }[][];
  const made = results[results.length - 1];

  report.created = made.length;
  report.tickets = made.slice(0, 5).map((t) => t.ticketNumber);
  await audit(user, 'tickets.imported', 'import', null, undefined, { module: module.name, file, tickets: made.length, from: made[0]?.ticketNumber, to: made[made.length - 1]?.ticketNumber, skippedAsDuplicates: report.duplicates });
  updateSheet(made.map((t) => t.id)); // their rows in the Excel sheet
  return report;
}
