import { useData } from '../../context/DataContext';
import { formatDateTime } from '../../lib/utils';
import type { Ticket } from '../../types';
import ModePill from '../ui/ModePill';
import ModuleBadge from '../ui/ModuleBadge';
import ClientStatCards from '../ui/ClientStatCards';
import FeedbackCard from './FeedbackCard';
import MeetLink from './MeetLink';
import PostConsultation from './PostConsultation';

/** The client's stat cards, booking details, the client's booking answers, post-consultation notes and feedback. */
export default function OverviewTab({ ticket }: { ticket: Ticket }) {
  const { tickets, getModule, getSession } = useData();
  const module = getModule(ticket.moduleId);
  const booking = getSession(ticket.id)?.booking;

  const minutes = booking ? Math.round((new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime()) / 60000) : 0;

  return (
    <div className="space-y-4">
      <ClientStatCards tickets={tickets.filter((t) => t.clientId === ticket.clientId)} />

      <section className="card">
        <h2 className="mb-3 font-semibold">Booking Details</h2>
        {booking ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div><dt className="text-xs text-ink-3">Module</dt><dd><ModuleBadge module={module} /></dd></div>
            <div><dt className="text-xs text-ink-3">Date / Time</dt><dd>{formatDateTime(booking.startTime)}</dd></div>
            <div><dt className="text-xs text-ink-3">Mode</dt><dd><ModePill mode={booking.mode} /></dd></div>
            <div><dt className="text-xs text-ink-3">Duration</dt><dd>{minutes} min</dd></div>
            <div>
              <dt className="text-xs text-ink-3">Meet link</dt>
              <dd>
                <MeetLink booking={booking} />
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-ink-2">No booking is attached to this ticket.</p>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Client's Booking Answers</h2>
        {module?.questions.length ? (
          <dl className="space-y-3">
            {module.questions.map((q) => (
              <div key={q.id}>
                <dt className="text-xs text-ink-3">{q.label}</dt>
                <dd className="whitespace-pre-line">{booking?.bookingAnswers[q.id] || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-ink-2">This booking form has no extra questions.</p>
        )}
      </section>

      <PostConsultation ticket={ticket} />
      <FeedbackCard ticket={ticket} />
    </div>
  );
}
