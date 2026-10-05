import { useData } from '../../context/DataContext';
import { FEEDBACK_FIELDS, type Ticket } from '../../types';

const labelOf = (key: string) => FEEDBACK_FIELDS.find((f) => f.key === key)?.label ?? key.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** "Client Feedback" card: star ratings and comments once the client has answered, otherwise a button that emails them the feedback link. */
export default function FeedbackCard({ ticket }: { ticket: Ticket }) {
  const { mutate } = useData();
  const entries = Object.entries(ticket.feedbackData);

  // Emails the client a one-time link to the feedback page (a new request replaces the earlier link).
  const sendRequest = () => mutate('/api/send-email', 'POST', { ticketId: ticket.id, feedbackRequest: true }, 'Feedback request sent');

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
