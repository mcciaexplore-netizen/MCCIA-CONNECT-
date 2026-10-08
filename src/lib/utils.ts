import { useEffect, useState, useSyncExternalStore } from 'react';
import { CLOSED_STATUSES, DEFAULT_SETTINGS, FEEDBACK_FIELDS, PAYMENT_LABELS, RECORDING_RECHECK_MINUTES, RECORDING_WINDOW_DAYS, STATUS_LABELS, type AuditLog, type Booking, type Client, type ClientInput, type CompanyRow, type PublicSettings, type Role, type Ticket, type TicketStatus } from '../types';

const MOBILE = '(max-width: 767px)';
/** True below 768px: tables turn into card lists and the navigation becomes a menu. */
export const useIsMobile = () =>
  useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(MOBILE);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(MOBILE).matches,
  );

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/** A role as people read it: super_admin → "Super admin", coordinator → "Coordinator". */
export const roleLabel = (role: string) => (role.charAt(0).toUpperCase() + role.slice(1)).replace(/_/g, ' ');

export const homeFor = (role: Role) => (role === 'super_admin' ? '/admin/dashboard' : '/coordinator/dashboard');

export const isOpen = (status: TicketStatus) => !CLOSED_STATUSES.includes(status);

/**
 * Whether Fireflies may still have this session's recording and it is not saved yet: an online session that is over (within
 * RECORDING_WINDOW_DAYS). Mirrors `due()` in api/_fireflies.ts. `quiet` also leaves out one Fireflies was asked about moments ago.
 */
export function recordingWanted(booking: Booking, quiet = false) {
  const now = Date.now();
  const ended = new Date(booking.endTime).getTime();
  const askedAt = booking.recordingCheckedAt ? new Date(booking.recordingCheckedAt).getTime() : 0;
  return booking.mode === 'online' && booking.status !== 'cancelled' && Boolean(booking.meetingLink) && !booking.recordingLink && ended < now && ended > now - RECORDING_WINDOW_DAYS * 86_400_000 && !(quiet && askedAt > now - RECORDING_RECHECK_MINUTES * 60_000);
}

/** Totals for a client's tickets: all, open, overdue, and the average of their 1-5 star feedback ratings. */
export function clientStats(tickets: Ticket[]) {
  const now = new Date();
  const ratings = tickets.flatMap((t) => FEEDBACK_FIELDS.map((f) => Number(t.feedbackData[f.key]))).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  return {
    total: tickets.length,
    open: tickets.filter((t) => isOpen(t.status)).length,
    overdue: tickets.filter((t) => isOpen(t.status) && t.dueDate && new Date(t.dueDate) < now).length,
    rating: ratings.length ? `${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)} / 5` : '—',
  };
}

// Dates and times are written in the studio's time zone (Settings > Time zone), whatever the browser's own zone is.
let studioTz = DEFAULT_SETTINGS.timezone.tz;
export const setStudioZone = (tz: string) => {
  studioTz = tz;
};
function written(iso: string, options: Intl.DateTimeFormatOptions) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: studioTz, hour12: true, ...options }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: get('day'), month: get('month'), year: get('year'), time: `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}` };
}
const DAY_PARTS = { day: '2-digit', month: 'short', year: 'numeric' } as const;
const TIME_PARTS = { hour: 'numeric', minute: '2-digit' } as const;
export const formatDate = (iso: string | null) => {
  if (!iso) return '—';
  const w = written(iso, DAY_PARTS);
  return `${w.day} ${w.month} ${w.year}`;
};
export const formatTime = (iso: string) => written(iso, TIME_PARTS).time;
/** The number in a ticket number (TKT-0121 is 121), for putting tickets in order (tickets of the same session time); 0 for a ticket without one. */
export const ticketSerial = (ticketNumber: string) => Number(ticketNumber.replace(/\D/g, '')) || 0;
/** The calendar date (YYYY-MM-DD) of an instant in the studio's time zone. */
export const studioDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: studioTz }).format(new Date(iso));
export const formatDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const w = written(iso, { ...DAY_PARTS, ...TIME_PARTS });
  return `${w.day} ${w.month} ${w.year}, ${w.time}`;
};

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

/** A client row as the editable form values (null columns become empty strings). */
export const toClientInput = (client: Client): ClientInput => ({
  companyName: client.companyName,
  personName: client.personName,
  email: client.email,
  phone: client.phone,
  jobTitle: client.jobTitle ?? '',
  scale: client.scale ?? '',
  industry: client.industry ?? '',
  udyamNo: client.udyamNo ?? '',
  acquisitionFrom: client.acquisitionFrom ?? '',
  isMember: client.isMember,
  membershipId: client.membershipId ?? '',
  district: client.district ?? '',
  gender: client.gender ?? '',
  category: client.category ?? '',
  subSector: client.subSector ?? '',
  employmentRange: client.employmentRange == null ? '' : String(client.employmentRange),
  onlinePresence: client.onlinePresence ?? '',
});

/**
 * The consultant form's answers as it shows them: the saved ones, plus what lives on the ticket itself (its status and payment) and the
 * Fireflies link of the session until someone writes a link of their own.
 */
export const postValues = (ticket: Ticket, booking?: Booking): Record<string, string> => ({
  ...(booking?.recordingLink ? { recording_link: booking.recordingLink } : {}),
  ...ticket.postConsultationData,
  consultation_status: STATUS_LABELS[ticket.status],
  payment_status: PAYMENT_LABELS[ticket.paymentStatus],
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const show = (value: unknown) =>
  typeof value === 'string' && ISO_DATE.test(value) ? formatDateTime(value) : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—');

/** What an audit log entry changed, e.g. "status: new → assigned, coordinator: Asha". */
export function describeChange(log: AuditLog) {
  const after = log.newValue ?? {};
  if (typeof after.message === 'string') return after.message; // e.g. "Auto-assigned to Neha Joshi (least bookings this month)"
  return Object.entries(after)
    .map(([key, value]) => (log.oldValue && key in log.oldValue ? `${key}: ${show(log.oldValue[key])} → ${show(value)}` : `${key}: ${show(value)}`))
    .join(', ');
}

/** A failed API call: the server's message, plus its HTTP status (409 = the slot was just taken). */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  blob?: boolean;
  anonymous?: boolean; // leave the session cookie out, so a signed-in staff member still books as a client on the public pages
}

/** The only way the browser talks to the backend: a Vercel function under /api (the session cookie goes along). */
export async function api<T = unknown>(path: string, { method = 'GET', body, blob, anonymous }: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: anonymous ? 'omit' : 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

/** The studio name, venue and time zone for pages with nobody signed in (login, landing, booking), fetched once. */
let publicSettings: Promise<PublicSettings> | undefined;
export function usePublicSettings(): PublicSettings {
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    publicSettings ??= api<PublicSettings>('/api/settings?public=1', { anonymous: true }).catch((e) => {
      publicSettings = undefined; // try again next time
      throw e;
    });
    publicSettings.then((loaded) => {
      setStudioZone(loaded.timezone.tz);
      setSettings(loaded);
    }).catch(() => {});
  }, []);
  return settings;
}

/** Cancelling a session removes its calendar event and emails the client, and cannot be undone: ask first. */
/** What the reassign warning needs: a client's company and how many clients it has, since they all move together. */
export const companyNote = (client: Client | undefined, clients: Client[], companies: CompanyRow[] = []) =>
  client && { name: companies.find((c) => c.id === client.companyId)?.name ?? client.companyName, clients: client.companyId ? clients.filter((c) => c.companyId === client.companyId).length : 1 };

export const confirmDelete = (ticketNumber: string) =>
  window.confirm(`Delete ${ticketNumber} for good? Its booking, notes and feedback link are removed and the Google Calendar event is deleted. The client is NOT emailed (cancel the session instead to tell them). This cannot be undone.`);

export const confirmDeleteTickets = (count: number, everything: boolean) =>
  window.confirm(`Delete ${count} ticket${count === 1 ? '' : 's'} for good? Their bookings, notes and feedback links are removed, their Google Calendar events are deleted and their rows leave the Excel sheet. Nobody is emailed. ${everything ? 'That is every ticket: the numbering starts again at TKT-0001. ' : ''}This cannot be undone.`);

export const confirmDeleteClient = (name: string, company: string, tickets: number) =>
  window.confirm(`Delete ${name} (${company}) for good? ${tickets ? `Their ${tickets} ticket${tickets === 1 ? '' : 's'} and sessions are deleted too, and their Google Calendar events removed.` : 'They have no tickets.'} Nobody is emailed. This cannot be undone.`);

export const confirmDeleteClients = (count: number, tickets: number) =>
  window.confirm(`Delete ${count} client${count === 1 ? '' : 's'} for good? ${tickets ? `Their ${tickets} ticket${tickets === 1 ? '' : 's'} and sessions are deleted too, their Google Calendar events removed and their rows taken out of the Excel sheet.` : 'They have no tickets.'} A company left with nobody is deleted as well. Nobody is emailed. This cannot be undone.`);

export const confirmDeleteCompanies = (count: number, clients: number, tickets: number) =>
  window.confirm(`Delete ${count} ${count === 1 ? 'company' : 'companies'} for good? ${clients ? `Their ${clients} client${clients === 1 ? '' : 's'}` : 'They have no clients'}${tickets ? ` and ${tickets} ticket${tickets === 1 ? '' : 's'} (with sessions, notes and feedback links) are deleted too, their Google Calendar events removed and their rows taken out of the Excel sheet` : ''}. Nobody is emailed. This cannot be undone.`);

export const confirmCancel = (count = 1) =>
  window.confirm(count === 1 ? 'Cancel this session? The calendar event is deleted and the client is emailed. This cannot be undone.' : `Cancel ${count} sessions? Their calendar events are deleted and the clients are emailed. This cannot be undone.`);
