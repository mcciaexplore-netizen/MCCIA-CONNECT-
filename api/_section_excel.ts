import ExcelJS from 'exceljs';
import { asc, eq, inArray } from 'drizzle-orm';
import { audit, db, HttpError, type AuthUser } from './_lib.js';
import { norm } from './_excel.js';
import { addSheet, importTemplate, readUpload } from './_excel_file.js';
import { parseDate, parseTime, splitTable } from './_import.js';
import { appletValues, workshopValues } from './_sections.js';
import { applets, workshops } from './_schema.js';
import { WORKSHOP_KIND_LABELS, WORKSHOP_STATUS_LABELS, WORKSHOP_STATUSES, type AppSettings, type WorkshopKind } from '../src/types/index.js';

/**
 * Excel export and bulk import for the Applets and Workshops pages: one tab with fixed columns. The export file can be filled in, or edited and
 * imported again: an applet with the same company and applet name, or a workshop with its number, is updated; anything else is added.
 * A file with a single bad row saves nothing: the answer lists every problem by its Excel row.
 */
export const EXCEL_SECTIONS = ['applets', 'workshops'] as const;
export type ExcelSection = (typeof EXCEL_SECTIONS)[number];

const MAX_ROWS = 1000;
const TAB: Record<ExcelSection, string> = { applets: 'Applets', workshops: 'Workshops' };

interface Col {
  header: string;
  key: string; // the field the form sends
  required?: boolean;
  width: number;
  hint: string;
}
const COLUMNS: Record<ExcelSection, Col[]> = {
  applets: [
    { header: 'Company', key: 'companyName', required: true, width: 30, hint: 'The company the applet was built for.' },
    { header: 'Contact Person', key: 'contactName', width: 24, hint: 'Optional.' },
    { header: 'Applet Name', key: 'appletName', required: true, width: 30, hint: 'A company can have several applets: one row each. The same company + applet name again updates that applet.' },
    { header: 'Live Link', key: 'liveLink', width: 40, hint: 'The web address of the deployed applet (https://…).' },
    { header: 'Deployed On', key: 'deployedOn', width: 14, hint: 'A date, e.g. 18/11/2026 (day first).' },
    { header: 'Notes', key: 'notes', width: 40, hint: 'Optional.' },
  ],
  workshops: [
    { header: 'Number', key: 'number', width: 10, hint: 'Leave empty for a new workshop (it gets the next W- or M- number). An existing number updates that workshop.' },
    { header: 'Type', key: 'kind', required: true, width: 18, hint: 'Workshop (Major) → W-…, or Mini Session → M-…. "W" and "M" work too.' },
    { header: 'Title', key: 'title', required: true, width: 34, hint: 'What the workshop was about.' },
    { header: 'Date', key: 'heldOn', required: true, width: 12, hint: 'e.g. 18/11/2026 (day first).' },
    { header: 'Start Time', key: 'startTime', width: 11, hint: 'e.g. 10:30 or 10:30 AM. Optional.' },
    { header: 'End Time', key: 'endTime', width: 11, hint: 'After the start time. Optional.' },
    { header: 'Mode', key: 'mode', width: 10, hint: 'Online or Offline (empty = Offline).' },
    { header: 'Venue / Link', key: 'venue', width: 30, hint: 'The address, or the meeting link when online.' },
    { header: 'Trainer', key: 'trainer', width: 22, hint: 'Optional.' },
    { header: 'Organisation', key: 'organisation', width: 26, hint: 'Who it was held for or with. Optional.' },
    { header: 'Participants', key: 'participants', width: 12, hint: 'A whole number. Optional.' },
    { header: 'Status', key: 'status', width: 12, hint: 'Scheduled, Completed or Cancelled (empty = Scheduled).' },
    { header: 'Notes', key: 'notes', width: 40, hint: 'Optional.' },
  ],
};

const ddmmyyyy = (date: string | null) => (date ? date.split('-').reverse().join('/') : '');

/** Every applet or workshop, as a one-tab workbook. */
export async function exportSection(section: ExcelSection, settings: AppSettings) {
  const rows =
    section === 'applets'
      ? (await db.select().from(applets).orderBy(asc(applets.companyName))).map((a) => [a.companyName, a.contactName ?? '', a.appletName, a.liveLink ?? '', ddmmyyyy(a.deployedOn), a.notes ?? ''])
      : (await db.select().from(workshops).orderBy(asc(workshops.ticketNumber))).map((w) => [
          w.ticketNumber, WORKSHOP_KIND_LABELS[w.kind], w.title, ddmmyyyy(w.heldOn), w.startTime ?? '', w.endTime ?? '', w.mode === 'online' ? 'Online' : 'Offline',
          w.venue ?? '', w.trainer ?? '', w.organisation ?? '', w.participants ?? '', WORKSHOP_STATUS_LABELS[w.status], w.notes ?? '',
        ]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  addSheet(workbook, TAB[section], COLUMNS[section], rows);
  return { buffer: await workbook.xlsx.writeBuffer(), count: rows.length };
}

/** The empty file to fill in, with a "How to fill" tab. */
export const sectionTemplate = (section: ExcelSection, settings: AppSettings) =>
  importTemplate(settings, TAB[section], COLUMNS[section].map(({ header, required }) => ({ label: header, required: Boolean(required) })), COLUMNS[section].map((c) => [c.header, c.required ? 'Yes' : '', c.hint]));

// ---------- reading a row ----------

const dateOf = (text: string, label: string) => {
  if (!text) return '';
  const parsed = parseDate(text);
  if (!parsed) throw new HttpError(400, `${label} "${text}" is not a date`);
  return parsed.date;
};
const timeOf = (text: string, label: string) => {
  if (!text) return '';
  const parsed = parseTime(text);
  if (!parsed) throw new HttpError(400, `${label} "${text}" is not a time`);
  return parsed;
};
const kindOf = (text: string): WorkshopKind | undefined => (/^m/i.test(text) ? 'mini' : /^(w|major)/i.test(text) ? 'workshop' : undefined);
const statusOf = (text: string) => (text ? WORKSHOP_STATUSES.find((s) => s === text.toLowerCase() || WORKSHOP_STATUS_LABELS[s].toLowerCase() === text.toLowerCase()) : 'scheduled');
const modeOf = (text: string) => (text ? text.toLowerCase() : 'offline');

/** Reads, checks and (when every row is fine) saves an uploaded file. */
export async function importSection(section: ExcelSection, user: AuthUser, base64: string, fileName: string) {
  const { table } = await readUpload(base64, fileName, [TAB[section]]);
  const { headers, rows, firstRow } = splitTable(table);
  const columns = COLUMNS[section];
  const at = new Map(columns.map((c) => [c.key, headers.findIndex((h) => norm(h) === norm(c.header))]));
  const missing = columns.filter((c) => c.required && at.get(c.key)! < 0);
  if (missing.length) throw new HttpError(400, `The file has no ${missing.map((c) => `"${c.header}"`).join(', ')} column. Download the template to see the columns.`);
  const filled = rows.map((cells, i) => ({ excelRow: firstRow + i, cells })).filter((r) => r.cells.some((cell) => cell.trim()));
  if (!filled.length) throw new HttpError(400, 'The file has no rows under the header');
  if (filled.length > MAX_ROWS) throw new HttpError(400, `The file has ${filled.length} rows. Import up to ${MAX_ROWS} at a time.`);
  const cell = (cells: string[], key: string) => (at.get(key)! >= 0 ? (cells[at.get(key)!] ?? '').trim() : '');

  const errors: string[] = [];
  const check = <T,>(excelRow: number, read: () => T) => {
    try {
      return read();
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      errors.push(`Row ${excelRow}: ${e.message}`);
      return null;
    }
  };

  if (section === 'applets') {
    const keyOf = (company: string, applet: string) => `${company.toLowerCase()}|${applet.toLowerCase()}`;
    const existing = new Map((await db.select({ id: applets.id, companyName: applets.companyName, appletName: applets.appletName }).from(applets)).map((a) => [keyOf(a.companyName, a.appletName), a.id]));
    const seen = new Set<string>();
    const parsed = filled.map(({ excelRow, cells }) =>
      check(excelRow, () => {
        const values = appletValues({ ...Object.fromEntries(columns.map((c) => [c.key, cell(cells, c.key)])), deployedOn: dateOf(cell(cells, 'deployedOn'), 'Deployed On') });
        const key = keyOf(values.companyName, values.appletName);
        if (seen.has(key)) throw new HttpError(400, `${values.companyName} / ${values.appletName} is in the file twice`);
        seen.add(key);
        return { values, id: existing.get(key) };
      }),
    );
    if (errors.length) return { added: 0, updated: 0, errors };
    const ok = parsed.filter((p) => p !== null);
    const fresh = ok.filter((p) => !p.id).map((p) => p.values);
    const changed = ok.filter((p) => p.id);
    if (fresh.length) await db.insert(applets).values(fresh);
    for (let i = 0; i < changed.length; i += 100) {
      const [first, ...rest] = changed.slice(i, i + 100).map((p) => db.update(applets).set(p.values).where(eq(applets.id, p.id!)));
      await db.batch([first, ...rest]);
    }
    await audit(user, 'applets.imported', 'applet', null, undefined, { file: fileName.slice(0, 200), added: fresh.length, updated: changed.length });
    return { added: fresh.length, updated: changed.length, errors };
  }

  const numbers = filled.map((r) => cell(r.cells, 'number').toUpperCase()).filter(Boolean);
  const existing = new Map(numbers.length ? (await db.select({ id: workshops.id, number: workshops.ticketNumber }).from(workshops).where(inArray(workshops.ticketNumber, numbers))).map((w) => [w.number, w.id]) : []);
  const seen = new Set<string>();
  const parsed = filled.map(({ excelRow, cells }) =>
    check(excelRow, () => {
      const number = cell(cells, 'number').toUpperCase();
      const kind = kindOf(cell(cells, 'kind'));
      if (!number && !kind) throw new HttpError(400, 'Type must be Workshop (Major) or Mini Session');
      if (number && !existing.has(number)) throw new HttpError(400, `There is no workshop ${number}. Leave Number empty to add a new one.`);
      if (number && seen.has(number)) throw new HttpError(400, `${number} is in the file twice`);
      seen.add(number);
      const status = statusOf(cell(cells, 'status'));
      if (!status) throw new HttpError(400, 'Status must be Scheduled, Completed or Cancelled');
      const values = workshopValues({
        ...Object.fromEntries(columns.map((c) => [c.key, cell(cells, c.key)])),
        heldOn: dateOf(cell(cells, 'heldOn'), 'Date'),
        startTime: timeOf(cell(cells, 'startTime'), 'Start Time'),
        endTime: timeOf(cell(cells, 'endTime'), 'End Time'),
        mode: modeOf(cell(cells, 'mode')),
        status,
      });
      return { values, kind: kind!, id: number ? existing.get(number) : undefined };
    }),
  );
  if (errors.length) return { added: 0, updated: 0, errors };
  const ok = parsed.filter((p) => p !== null);
  const fresh = ok.filter((p) => !p.id).map((p) => ({ ...p.values, kind: p.kind }));
  const changed = ok.filter((p) => p.id);
  if (fresh.length) await db.insert(workshops).values(fresh); // numbered in file order by the trigger
  for (let i = 0; i < changed.length; i += 100) {
    const [first, ...rest] = changed.slice(i, i + 100).map((p) => db.update(workshops).set(p.values).where(eq(workshops.id, p.id!)));
    await db.batch([first, ...rest]);
  }
  await audit(user, 'workshops.imported', 'workshop', null, undefined, { file: fileName.slice(0, 200), added: fresh.length, updated: changed.length });
  return { added: fresh.length, updated: changed.length, errors };
}
