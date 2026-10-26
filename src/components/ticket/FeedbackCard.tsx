import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { cn } from '../../lib/utils';
import Modal from '../ui/Modal';
import { FEEDBACK_COMMENTS, FEEDBACK_COMMENTS_HINT, FEEDBACK_COMMENTS_LABEL, FEEDBACK_FIELDS, MAX_FEEDBACK_COMMENTS, type Ticket } from '../../types';

const labelOf = (key: string) => (key === FEEDBACK_COMMENTS ? FEEDBACK_COMMENTS_LABEL : (FEEDBACK_FIELDS.find((f) => f.key === key)?.label ?? key));

/** "Client Feedback" card: the star ratings and the Additional Suggestions once the client has answered, otherwise a button that emails them the feedback link. */
export default function FeedbackCard({ ticket }: { ticket: Ticket }) {
  const { mutate } = useData();
  // The ratings the form asks for, in its order, then the Additional Suggestions (an older ticket's rating that was dropped from the form is not shown).
  const data = ticket.feedbackData;
  const entries = [...FEEDBACK_FIELDS.map((f) => f.key), FEEDBACK_COMMENTS].filter((key) => key in data).map((key): [string, string] => [key, data[key]]);

  // Emails the client a one-time link to the feedback page (a new request replaces the earlier link).
  const sendRequest = () => mutate('/api/send-email', 'POST', { ticketId: ticket.id, feedbackRequest: true }, 'Feedback request sent');
  const [adding, setAdding] = useState(false);

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Client Feedback</h2>
      {entries.length === 0 ? (
        <div className="flex items-center justify-between rounded-md bg-page px-4 py-3">
          <span className="text-ink-2">Awaiting feedback</span>
          <div className="flex gap-2">
            <button className="btn" onClick={() => setAdding(true)}>Add Feedback</button>
            <button className="btn" onClick={sendRequest}>Send Request</button>
          </div>
        </div>
      ) : (
        <dl className="space-y-2">
          {entries.map(([key, value]) => {
            const stars = Number(value);
            const isRating = Number.isInteger(stars) && stars >= 1 && stars <= 5;
            return (
              <div key={key} className={isRating ? 'flex items-center justify-between gap-4' : undefined}>
                <dt className="text-ink-2">{labelOf(key)}</dt>
                <dd aria-label={isRating ? `${stars} out of 5` : undefined} className={isRating ? 'text-base tracking-wider text-gold' : 'mt-0.5 whitespace-pre-line break-words'}>
                  {isRating ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {adding && <AddFeedbackModal ticket={ticket} onClose={() => setAdding(false)} />}
    </section>
  );
}

/** Staff enter the client's feedback themselves: the same three 1-5 star questions and Additional Suggestions as the client's feedback page. */
function AddFeedbackModal({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const { mutate } = useData();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState('');
  const [sending, setSending] = useState(false);
  const complete = FEEDBACK_FIELDS.every((f) => ratings[f.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    const saved = await mutate('/api/tickets', 'POST', { action: 'save-feedback', ticketId: ticket.id, ratings, comments }, 'Feedback saved');
    setSending(false);
    if (saved) onClose();
  };

  return (
    <Modal title="Add Feedback" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        {FEEDBACK_FIELDS.map((field) => (
          <fieldset key={field.key}>
            <legend className="label">{field.question} *</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  aria-label={`${n} star${n === 1 ? '' : 's'} for ${field.question}`}
                  aria-pressed={ratings[field.key] === n}
                  onClick={() => setRatings({ ...ratings, [field.key]: n })}
                  className={cn('h-10 w-10 rounded-md text-2xl leading-none transition', (ratings[field.key] ?? 0) >= n ? 'text-gold' : 'text-ink-3 hover:text-gold')}
                >
                  {(ratings[field.key] ?? 0) >= n ? '★' : '☆'}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <div>
          <label className="label" htmlFor="staff-additional-suggestions">{FEEDBACK_COMMENTS_LABEL}</label>
          <textarea id="staff-additional-suggestions" className="input" rows={4} maxLength={MAX_FEEDBACK_COMMENTS} placeholder={FEEDBACK_COMMENTS_HINT} value={comments} onChange={(e) => setComments(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!complete || sending}>{sending ? 'Saving…' : 'Save feedback'}</button>
        </div>
      </form>
    </Modal>
  );
}
