import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { format } from 'date-fns';
import PublicShell from '../../components/layout/PublicShell';
import EmptyState from '../../components/ui/EmptyState';
import { api, ApiError, errorMessage, formatTime, pollMeetLink } from '../../lib/utils';
import type { BookingSummary } from '../../types';

/** /confirmed/:bookingId (public): the receipt shown after booking. */
export default function ConfirmationPage() {
  const { bookingId } = useParams();
  const [booking, setBooking] = useState<BookingSummary | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<BookingSummary>(`/api/bookings?id=${encodeURIComponent(bookingId ?? '')}`)
      .then(setBooking)
      .catch(setError);
  }, [bookingId]);
  useEffect(load, [load]);

  // An online booking may not have its Meet link yet (the Apps Script saves it a few seconds later): poll for it for a while.
  const waitingForLink = booking?.mode === 'online' && !booking.meetingLink;
  useEffect(() => {
    if (!waitingForLink || !bookingId) return;
    return pollMeetLink(bookingId, (meetingLink) => meetingLink && setBooking((current) => current && { ...current, meetingLink }));
  }, [waitingForLink, bookingId]);

  const rows: [string, string][] = booking
    ? [
        ['Module', booking.moduleName],
        ['Date', format(new Date(booking.startsAt), 'EEEE, d MMMM yyyy')],
        ['Time', `${formatTime(booking.startsAt)} – ${formatTime(booking.endsAt)}`],
        ['Mode', booking.mode === 'online' ? 'Online (Google Meet)' : 'Offline (in person)'],
        ...(booking.mode === 'offline' && booking.venue ? ([['Venue', booking.venue]] as [string, string][]) : []),
      ]
    : [];

  return (
    <PublicShell>
      {error ? (
        <div className="card">
          <EmptyState icon="alert" message={error instanceof ApiError && error.status === 404 ? 'Booking not found' : 'Could not load your booking'} hint={errorMessage(error)} action={error instanceof ApiError && error.status === 404 ? undefined : { label: 'Retry', onClick: load }} />
        </div>
      ) : !booking ? (
        <p role="status" className="animate-pulse text-center text-ink-2">Loading…</p>
      ) : (
        <div className="card space-y-5 p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-8 w-8">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Booking Confirmed!</h1>
            <p className="mt-1 text-ink-2">Thank you, {booking.clientName.split(' ')[0]}.</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-3">Ticket number</p>
            <p className="text-3xl font-bold tracking-wide text-primary">{booking.ticketNumber}</p>
          </div>
          <dl className="space-y-2 rounded-md bg-page p-4 text-left">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-ink-2">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {booking.mode === 'online' &&
            (booking.meetingLink ? (
              <a className="btn btn-primary h-11 w-full" href={booking.meetingLink} target="_blank" rel="noreferrer">Join Google Meet</a>
            ) : (
              <p className="rounded-md bg-gold-light px-4 py-3 text-sm text-[#8a6d1c]">Your Google Meet link is being prepared and will be emailed to you.</p>
            ))}
          {booking.confirmationEmail && <p className="text-sm text-ink-2">Confirmation email sent to <span className="font-medium text-ink">{booking.clientEmail}</span></p>}
        </div>
      )}
    </PublicShell>
  );
}
