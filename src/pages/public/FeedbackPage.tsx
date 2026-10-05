import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import PublicShell from '../../components/layout/PublicShell';
import EmptyState from '../../components/ui/EmptyState';
import { api, ApiError, cn, errorMessage, formatDate, setStudioZone } from '../../lib/utils';
import { FEEDBACK_FIELDS, MAX_FEEDBACK_COMMENTS, type FeedbackForm } from '../../types';

/** /feedback/:token (public, no login): the client rates their session in four 1-5 star questions and adds comments. The link works once. */
export default function FeedbackPage() {
  const { token } = useParams();
  const [form, setForm] = useState<FeedbackForm | null>(null);
  const [problem, setProblem] = useState<ApiError | Error | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setProblem(null);
    api<FeedbackForm>(`/api/feedback/${encodeURIComponent(token ?? '')}`, { anonymous: true })
      .then((loaded) => {
        setStudioZone(loaded.zone.tz);
        setForm(loaded);
      })
      .catch(setProblem);
  }, [token]);
  useEffect(load, [load]);

  const complete = FEEDBACK_FIELDS.every((f) => ratings[f.key]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await api(`/api/feedback/${encodeURIComponent(token ?? '')}`, { method: 'POST', anonymous: true, body: { ratings, comments } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    }
    setSending(false);
  };

  // An error from the server (a used or expired link, a wrong link) says what to do; anything else can be retried.
  const gone = problem instanceof ApiError && [404, 410].includes(problem.status);

  return (
    <PublicShell>
      {problem ? (
        <div className="card">
          <EmptyState icon={gone ? 'check' : 'alert'} message={gone ? errorMessage(problem) : 'Could not load the feedback form'} hint={gone ? undefined : errorMessage(problem)} action={gone ? undefined : { label: 'Retry', onClick: load }} />
        </div>
      ) : !form ? (
        <p role="status" className="animate-pulse text-center text-ink-2">Loading…</p>
      ) : done ? (
        <div className="card space-y-2 p-8 text-center">
          <h1 className="text-2xl font-semibold">Thank you!</h1>
          <p className="text-ink-2">Your feedback has been received. It helps us improve.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-semibold">How was your session?</h1>
            <p className="mt-1 text-ink-2">
              Hello {form.clientName.split(' ')[0]}, thank you for your {form.moduleName} session on {formatDate(form.sessionAt)}. Rate it from 1 star (poor) to 5 stars (excellent).
            </p>
          </div>
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
            <label className="label">Anything else you would like to tell us?</label>
            <textarea className="input" rows={4} maxLength={MAX_FEEDBACK_COMMENTS} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          {error && <p role="alert" className="rounded-md bg-danger-light px-3 py-2 text-sm text-danger-dark">{error}</p>}
          <button className="btn btn-primary h-11 w-full" disabled={!complete || sending}>{sending ? 'Sending…' : 'Send feedback'}</button>
          <p className="text-center text-xs text-ink-3">Reference {form.ticketNumber}</p>
        </form>
      )}
    </PublicShell>
  );
}
