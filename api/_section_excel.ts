import ExcelJS from 'exceljs';
import { asc, eq } from 'drizzle-orm';
import { audit, db, HttpError, type AuthUser } from './_lib.js';
import { norm } from './_excel.js';
import { addSheet, importTemplate, readUpload } from './_excel_file.js';
import { parseDate, splitTable } from './_import.js';
import { appletValues, participantValues, workshopCode } from './_sections.js';
import { applets, workshopParticipants, workshops } from './_schema.js';
import { kindOfCode, WORKSHOP_KIND_LABELS, WORKSHOP_STATUS_LABELS, type AppSettings } from '../src/types/index.js';

/**
 * Excel export and bulk import for the Applets and Workshops pages, with fixed columns (for workshops: the studio's own sheet, one row per participant).
 * The export can be edited and imported again: an applet with the same company and applet name, or a participant of the same workshop with the
 * same name with the same phone (else email), is updated; anything else is added.
 * A file with a single bad row saves nothing: the answer lists every problem by its Excel row.
 */
export const EXCEL_SECTIONS = ['applets', 'workshops'] as const;
export type ExcelSection = (typeof EXCEL_SECTIONS)[number];

const MAX_ROWS = 3000;
const TAB: Record<ExcelSection, string> = { applets: 'Applets', workshops: 'Participants' };

interface Col {
  header: string;
  key: string; // the field the form sends
  required?: boolean;
  width: number;
  hint: string;
  aliases?: string[]; // other headers a file may use for it
}
const COLUMNS: Record<ExcelSection, Col[]> = {
  applets: [
    { header: 'Company', key: 'companyName', required: true, width: 30, hint: 'The company the applet was built for.' },
    { header: 'Membership', key: 'membership', width: 14, hint: 'Member or Non Member (optional).', aliases: ['Member', 'Member / Non Member'] },
    { header: 'Membership ID', key: 'membershipNo', width: 16, hint: 'The MCCIA membership ID, e.g. IA-14984. Optional.', aliases: ['Membership No', 'Membership Number', 'Member ID'] },
    { header: 'Contact Person', key: 'contactName', width: 24, hint: 'Optional. Several names: separate with ;', aliases: ['Name'] },
    { header: 'Phone', key: 'phone', width: 22, hint: 'Optional. Several numbers: separate with ;', aliases: ['Mobile', 'Tel. / Mobile', 'Contact No'] },
    { header: 'Email', key: 'email', width: 32, hint: 'Optional. Several addresses: separate with ;', aliases: ['Email ID', 'E-mail'] },
    { header: 'Applet Name', key: 'appletName', width: 30, hint: 'Optional. A company can have several applets: one row each. The same company + applet name again updates that applet.' },
    { header: 'Live Link', key: 'liveLink', width: 40, hint: 'The web address of the deployed applet (https://…).' },
    { header: 'Deployed On', key: 'deployedOn', width: 14, hint: 'A date, e.g. 18/11/2026 (day first).' },
    { header: 'Notes', key: 'notes', width: 40, hint: 'Optional.' },
  ],
  // The studio's own workshop sheet, column for column (its "Column 6" is the membership number).
  workshops: [
    { header: 'Company Name', key: 'companyName', width: 28, hint: 'Optional.' },
    { header: 'UDYAM No', key: 'udyamNo', width: 20, hint: 'Optional.' },
    { header: 'Name', key: 'personName', required: true, width: 24, hint: 'The participant.' },
    { header: 'Tel. / Mobile', key: 'phone', width: 16, hint: 'Optional.', aliases: ['Phone', 'Mobile', 'Tel'] },
    { header: 'Email', key: 'email', width: 28, hint: 'Optional.' },
    { header: 'Membership No', key: 'membershipNo', width: 14, hint: 'The MCCIA membership number, e.g. IA-14984. Optional.', aliases: ['Column 6', 'Membership', 'Member ID'] },
    { header: 'Designation', key: 'designation', width: 18, hint: 'Optional.' },
    { header: 'Mode', key: 'mode', width: 10, hint: 'Offline or Online.' },
    { header: 'months', key: 'month', width: 10, hint: 'Optional.', aliases: ['Month'] },
    { header: 'Date', key: 'sessionDate', width: 12, hint: 'e.g. 02/01/2026 (day first).' },
    { header: 'Time Slot', key: 'timeSlot', width: 10, hint: 'As you write it, e.g. 3.' },
    { header: 'Confirmation Status', key: 'confirmationStatus', width: 18, hint: 'e.g. Confirmed / Unconfirmed.' },
    { header: 'Attendance', key: 'attendance', width: 12, hint: 'e.g. Attended / No Show.' },
    { header: 'Deployment Status', key: 'deploymentStatus', width: 18, hint: 'e.g. Deployed / Did not try.' },
    { header: 'Workshop ID', key: 'code', required: true, width: 14, hint: 'W… (Workshop, Major) or E… (Mini Session), e.g. W21 or E01. A new ID creates that workshop.' },
    { header: 'Allocation', key: 'allocation', width: 14, hint: 'Optional.' },
    { header: 'Cons-Status', key: 'consStatus', width: 14, hint: 'Optional.' },
    { header: 'Calling', key: 'calling', width: 14, hint: 'Optional.' },
  ],
};

const ddmmyyyy = (date: string | null) => (date ? date.split('-').reverse().join('/') : '');

/** Every applet, or every workshop participant (with a second tab listing the workshops), as a workbook. */
export async function exportSection(section: ExcelSection, settings: AppSettings) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = settings.brand.name;
  let count: number;
  if (section === 'applets') {
    const rows = (await db.select().from(applets).orderBy(asc(applets.companyName))).map((a) => [a.companyName, a.membership ?? '', a.membershipNo ?? '', a.contactName ?? '', a.phone ?? '', a.email ?? '', a.appletName ?? '', a.liveLink ?? '', ddmmyyyy(a.deployedOn), a.notes ?? '']);
    addSheet(workbook, TAB.applets, COLUMNS.applets, rows);
    count = rows.length;
  } else {
    const [all, people] = await Promise.all([db.select().from(workshops).orderBy(asc(workshops.code)), db.select().from(workshopParticipants).orderBy(asc(workshopParticipants.personName))]);
    const codeOf = new Map(all.map((w) => [w.id, w.code]));
    const rows = people.map((p) => COLUMNS.workshops.map(({ key }) => (key === 'code' ? (codeOf.get(p.workshopId) ?? '') : key === 'sessionDate' ? ddmmyyyy(p.sessionDate) : ((p as Record<string, unknown>)[key] as string | null) ?? '')));
    addSheet(workbook, TAB.workshops, COLUMNS.workshops, rows);
    const counted = (id: string) => people.filter((p) => p.workshopId === id).length;
    addSheet(
      workbook,
      'Workshops',
      ['Workshop ID', 'Type', 'Workshop Name', 'Date', 'Start Time', 'End Time', 'Mode', 'Venue / Link', 'Trainer', 'Organisation', 'Participants', 'Status', 'Notes'].map((header) => ({ header, width: header === 'Workshop Name' || header === 'Notes' ? 32 : 14 })),
      all.map((w) => [w.code, WORKSHOP_KIND_LABELS[w.kind], w.title, ddmmyyyy(w.heldOn), w.startTime ?? '', w.endTime ?? '', w.mode === 'online' ? 'Online' : 'Offline', w.venue ?? '', w.trainer ?? '', w.organisation ?? '', counted(w.id), WORKSHOP_STATUS_LABELS[w.status], w.notes ?? '']),
    );
    count = rows.length;
  }
  return { buffer: await workbook.xlsx.writeBuffer(), count };
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

/** Reads, checks and (when every row is fine) saves an uploaded file. */
export async function importSection(section: ExcelSection, user: AuthUser, base64: string, fileName: string) {
  const { table } = await readUpload(base64, fileName, [TAB[section]]);
  const { headers, rows, firstRow } = splitTable(table);
  const columns = COLUMNS[section];
  const at = new Map(columns.map((c) => [c.key, headers.findIndex((h) => [c.header, ...(c.aliases ?? [])].some((name) => norm(name) === norm(h)))]));
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
    const keyOf = (company: string, applet: string | null) => `${company.trim().toLowerCase()}|${(applet ?? '').trim().toLowerCase()}`;
    const existing = new Map((await db.select({ id: applets.id, companyName: applets.companyName, appletName: applets.appletName }).from(applets)).map((a) => [keyOf(a.companyName, a.appletName), a.id]));
    const seen = new Set<string>();
    const parsed = filled.map(({ excelRow, cells }) =>
      check(excelRow, () => {
        const values = appletValues({ ...Object.fromEntries(columns.map((c) => [c.key, cell(cells, c.key)])), deployedOn: dateOf(cell(cells, 'deployedOn'), 'Deployed On') });
        const key = keyOf(values.companyName, values.appletName);
        if (seen.has(key)) throw new HttpError(400, `${values.companyName}${values.appletName ? ` / ${values.appletName}` : ''} is in the file twice`);
        seen.add(key);
        return { values, id: existing.get(key) };
      }),
    );
    if (errors.length) return { added: 0, updated: 0, errors, workshops: 0 };
    const ok = parsed.filter((p) => p !== null);
    const fresh = ok.filter((p) => !p.id).map((p) => p.values);
    const changed = ok.filter((p) => p.id);
    if (fresh.length) await db.insert(applets).values(fresh);
    for (let i = 0; i < changed.length; i += 100) {
      const [first, ...rest] = changed.slice(i, i + 100).map((p) => db.update(applets).set(p.values).where(eq(applets.id, p.id!)));
      await db.batch([first, ...rest]);
    }
    await audit(user, 'applets.imported', 'applet', null, undefined, { file: fileName.slice(0, 200), added: fresh.length, updated: changed.length });
    return { added: fresh.length, updated: changed.length, errors, workshops: 0 };
  }

  // Workshops: each row is a participant of the workshop in its Workshop ID column; an ID that is not here yet becomes a new workshop.
  const known = new Map((await db.select({ id: workshops.id, code: workshops.code }).from(workshops)).map((w) => [w.code.toLowerCase(), w.id]));
  const people = new Map(
    (await db.select({ id: workshopParticipants.id, workshopId: workshopParticipants.workshopId, email: workshopParticipants.email, phone: workshopParticipants.phone, personName: workshopParticipants.personName }).from(workshopParticipants)).map((p) => [personKey(p.workshopId, p), p.id]),
  );
  const seen = new Set<string>();
  const parsed = filled.map(({ excelRow, cells }) =>
    check(excelRow, () => {
      const code = workshopCode(cell(cells, 'code'));
      const values = participantValues({ ...Object.fromEntries(columns.map((c) => [c.key, cell(cells, c.key)])), sessionDate: dateOf(cell(cells, 'sessionDate'), 'Date') });
      const key = personKey(code.toLowerCase(), values);
      if (seen.has(key)) throw new HttpError(400, `${values.personName} is in workshop ${code} twice`);
      seen.add(key);
      return { code, values };
    }),
  );
  if (errors.length) return { added: 0, updated: 0, errors, workshops: 0 };
  const ok = parsed.filter((p) => p !== null);

  // New workshops first, dated by their earliest participant; the name and the rest are filled in on the page.
  const newCodes = [...new Map(ok.filter((p) => !known.has(p.code.toLowerCase())).map((p) => [p.code.toLowerCase(), p.code])).values()];
  if (newCodes.length) {
    const created = await db
      .insert(workshops)
      .values(newCodes.map((code) => {
        const rows = ok.filter((p) => p.code.toLowerCase() === code.toLowerCase());
        const dates = rows.map((p) => p.values.sessionDate).filter((d): d is string => Boolean(d)).sort();
        return { code, kind: kindOfCode(code), title: '', heldOn: dates[0] ?? null, mode: /^online$/i.test(rows[0].values.mode ?? '') ? ('online' as const) : ('offline' as const) };
      }))
      .returning({ id: workshops.id, code: workshops.code });
    for (const w of created) known.set(w.code.toLowerCase(), w.id);
  }

  const placed = ok.map((p) => {
    const workshopId = known.get(p.code.toLowerCase())!;
    return { values: { ...p.values, workshopId }, id: people.get(personKey(workshopId, p.values)) };
  });
  const fresh = placed.filter((p) => !p.id).map((p) => p.values);
  const changed = placed.filter((p) => p.id);
  for (let i = 0; i < fresh.length; i += 500) await db.insert(workshopParticipants).values(fresh.slice(i, i + 500));
  for (let i = 0; i < changed.length; i += 100) {
    const [first, ...rest] = changed.slice(i, i + 100).map((p) => db.update(workshopParticipants).set(p.values).where(eq(workshopParticipants.id, p.id!)));
    await db.batch([first, ...rest]);
  }
  await audit(user, 'workshops.imported', 'workshop', null, undefined, { file: fileName.slice(0, 200), added: fresh.length, updated: changed.length, newWorkshops: newCodes });
  return { added: fresh.length, updated: changed.length, errors, workshops: newCodes.length };
}

/** Who a participant is within a workshop: their name with their phone, else their email (colleagues often share a company email). */
function personKey(workshop: string, p: { email: string | null; phone: string | null; personName: string }) {
  return `${workshop}|${p.personName.trim().toLowerCase()}|${(p.phone || p.email || '').trim().toLowerCase()}`;
}
