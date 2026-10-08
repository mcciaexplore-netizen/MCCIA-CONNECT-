import { useData } from '../../context/DataContext';
import { FEEDBACK_COMMENTS, FEEDBACK_COMMENTS_LABEL, FEEDBACK_FIELDS, type Ticket } from '../../types';

const labelOf = (key: string) => (key === FEEDBACK_COMMENTS ? FEEDBACK_COMMENTS_LABEL : (FEEDBACK_FIELDS.find((f) => f.key === key)?.label ?? key));

/** "Client Feedback" card: the star ratings and the Additional Suggestions once the client has answered, otherwise a button that emails them the feedback link. */
export default function FeedbackCard({ ticket }: { ticket: Ticket }) {
  const { mutate } = useData();
  // The ratings the form asks for, in its order, then the Additional Suggestions (an older ticket's rating that was dropped from the form is not shown).
  const data = ticket.feedbackData;
  const entries = [...FEEDBACK_FIELDS.map((f) => f.key), FEEDBACK_COMMENTS].filter((key) => key in data).map((key): [string, string] => [key, data[key]]);

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
              <div key={key} className={isRating ? 'flex items-center justify-between gap-4' : undefined}>
                <dt className="text-ink-2">{labelOf(key)}</dt>
                <dd aria-label={isRating ? `${stars} out of 5` : undefined} className={isRating ? 'text-base tracking-wider text-gold' : 'mt-0.5 whitespace-pre-line'}>
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
