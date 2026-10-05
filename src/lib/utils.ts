import { useSyncExternalStore } from 'react';
import { format } from 'date-fns';
import { CLOSED_STATUSES, type AuditLog, type BookingSummary, type Client, type ClientInput, type Role, type Ticket, type TicketStatus } from '../types';

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

export const homeFor = (role: Role | null) =>
  role === 'admin' ? '/admin/dashboard' : role === 'coordinator' ? '/coordinator/dashboard' : '/login';

export const isOpen = (status: TicketStatus) => !CLOSED_STATUSES.includes(status);

/** Totals for a client's tickets: all, open, overdue, and the average of their 1-5 star feedback ratings. */
export function clientStats(tickets: Ticket[]) {
  const now = new Date();
  const ratings = tickets.flatMap((t) => Object.values(t.feedbackData).map(Number)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  return {
    total: tickets.length,
    open: tickets.filter((t) => isOpen(t.status)).length,
    overdue: tickets.filter((t) => isOpen(t.status) && t.dueDate && new Date(t.dueDate) < now).length,
    rating: ratings.length ? `${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)} / 5` : '—',
  };
}

export const formatDate = (iso: string | null) => (iso ? format(new Date(iso), 'dd MMM yyyy') : '—');
export const formatTime = (iso: string) => format(new Date(iso), 'h:mm a');
export const formatDateTime = (iso: string | null) => (iso ? format(new Date(iso), 'dd MMM yyyy, h:mm a') : '—');

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
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const show = (value: unknown) =>
  typeof value === 'string' && ISO_DATE.test(value) ? formatDateTime(value) : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—');

/** What an audit log entry changed, e.g. "status: new → assigned, coordinator: Asha". */
export function describeChange(log: AuditLog) {
  const after = log.newValue ?? {};
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
}

/** The only way the browser talks to the backend: a Vercel function under /api (the session cookie goes along). */
export async function api<T = unknown>(path: string, { method = 'GET', body, blob }: ApiOptions = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  }
  return (blob ? res.blob() : res.json()) as Promise<T>;
}

/**
 * Asks for the booking's Google Meet link every `interval` ms until it exists, then calls onReceived(link).
 * Calls onReceived(null) when `timeout` ms pass without one. Returns a function that stops the polling.
 */
export function pollMeetLink(bookingId: string, onReceived: (link: string | null) => void, timeout = 10_000, interval = 2000) {
  const maxAttempts = timeout / interval;
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    try {
      const { meetingLink } = await api<BookingSummary>(`/api/bookings?id=${encodeURIComponent(bookingId)}`);
      if (meetingLink) {
        clearInterval(poll);
        onReceived(meetingLink);
        return;
      }
    } catch {
      // the next attempt tries again
    }
    if (attempts >= maxAttempts) {
      clearInterval(poll);
      onReceived(null);
    }
  }, interval);
  return () => clearInterval(poll);
}
