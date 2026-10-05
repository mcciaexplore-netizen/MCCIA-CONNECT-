import { useData } from '../../context/DataContext';
import { formatDate } from '../../lib/utils';
import { FEEDBACK_FIELDS, type Ticket } from '../../types';

const labelOf = (key: string) => FEEDBACK_FIELDS.find((f) => f.key === key)?.label ?? key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "Client Feedback" card: star ratings once feedback is recorded, otherwise a button that emails the client a request. */
export default function FeedbackCard({ ticket }: { ticket: Ticket }) {
  const { settings, getClient, getModule, getSession, mutate } = useData();
  const entries = Object.entries(ticket.feedbackData);

  const sendRequest = () => {
    const client = getClient(ticket.clientId);
    const session = getSession(ticket.id);
    const message = [
      `Hello ${client?.personName ?? ''},`,
      '',
      `Thank you for your ${getModule(ticket.moduleId)?.name ?? ''} session${session ? ` on ${formatDate(session.booking.startTime)}` : ''}. We would love to hear how it went.`,
      '',
      'Please reply to this email with a rating from 1 (poor) to 5 (excellent) for:',
      ...FEEDBACK_FIELDS.map((f) => `- ${f.label}`),
      '',
      'and any comments you have.',
      '',
      settings.brand.name,
    ].join('\n');
    mutate('/api/send-email', 'POST', { ticketId: ticket.id, subject: 'How was your session?', message }, 'Feedback request sent');
  };

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Client Feedback</h2>
      {entries.length === 0 ? (
        <div className="flex items-center justify-between rounded-md bg-page px-4 py-3">
          <span className="text-ink-2">Awaiting feedback</span>
          <button className="btn" onClick={sendRequest}>Send Request</button>
        </div>
      ) : (
        <dl className="space-y-2">
          {entries.map(([key, value]) => {
            const stars = Number(value);
            const isRating = Number.isInteger(stars) && stars >= 1 && stars <= 5;
            return (
              <div key={key} className="flex items-center justify-between gap-4">
                <dt className="text-ink-2">{labelOf(key)}</dt>
                <dd aria-label={isRating ? `${stars} out of 5` : undefined} className={isRating ? 'text-base tracking-wider text-gold' : 'text-right'}>
                  {isRating ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </section>
  );
}
