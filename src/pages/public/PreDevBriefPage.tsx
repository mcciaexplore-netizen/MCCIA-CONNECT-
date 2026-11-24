import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import PublicShell from '../../components/layout/PublicShell';
import EmptyState from '../../components/ui/EmptyState';
import { api, ApiError, errorMessage } from '../../lib/utils';
import { PRE_DEV_BRIEF_DETAILS, PRE_DEV_BRIEF_SECTIONS, type PreDevBriefForm } from '../../types';

/** /predev/:token (public, no login): the client fills in the Pre-Development Brief's App Details and 18 questions. The link works once. */
export default function PreDevBriefPage() {
  const { token } = useParams();
  const [form, setForm] = useState<PreDevBriefForm | null>(null);
  const [problem, setProblem] = useState<ApiError | Error | null>(null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setProblem(null);
    api<PreDevBriefForm>(`/api/predev/${encodeURIComponent(token ?? '')}`, { anonymous: true }).then(setForm).catch(setProblem);
  }, [token]);
  useEffect(load, [load]);

  const complete = PRE_DEV_BRIEF_DETAILS.every((f) => details[f.id]?.trim()) && PRE_DEV_BRIEF_SECTIONS.every((s) => s.questions.every((q) => answers[q.id]?.trim()));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      await api(`/api/predev/${encodeURIComponent(token ?? '')}`, { method: 'POST', anonymous: true, body: { details, answers } });
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
          <EmptyState icon={gone ? 'check' : 'alert'} message={gone ? errorMessage(problem) : 'Could not load the Pre-Development Brief'} hint={gone ? undefined : errorMessage(problem)} action={gone ? undefined : { label: 'Retry', onClick: load }} />
        </div>
      ) : !form ? (
        <p role="status" className="animate-pulse text-center text-ink-2">Loading…</p>
      ) : done ? (
        <div className="card space-y-2 p-8 text-center">
          <h1 className="text-2xl font-semibold">Thank you!</h1>
          <p className="text-ink-2">Your Pre-Development Brief has been received. Our team will be in touch.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-semibold">Pre-Development Brief</h1>
            <p className="mt-1 text-ink-2">
              Hello {form.clientName.split(' ')[0]}, before we start building your {form.moduleName} application, please fill this in together with your team (30 to 45 minutes). &ldquo;I don&rsquo;t know yet&rdquo; is a valid answer for anything you are unsure of.
            </p>
          </div>

          <fieldset className="space-y-4">
            <legend className="label mb-1">App details</legend>
            {PRE_DEV_BRIEF_DETAILS.map((field) => (
              <div key={field.id}>
                <label className="label" htmlFor={field.id}>{field.label} *</label>
                <input id={field.id} className="input" required value={details[field.id] ?? ''} onChange={(e) => setDetails({ ...details, [field.id]: e.target.value })} />
              </div>
            ))}
          </fieldset>

          {PRE_DEV_BRIEF_SECTIONS.map((section) => (
            <fieldset key={section.heading} className="space-y-4 border-t border-line pt-4">
              <legend className="label mb-1">{section.heading}</legend>
              {section.questions.map((q) => (
                <div key={q.id}>
                  <label className="label" htmlFor={q.id}>{q.q} *</label>
                  <p className="mb-1 text-xs text-ink-3">{q.hint}</p>
                  <textarea id={q.id} className="input" rows={3} required value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                </div>
              ))}
            </fieldset>
          ))}

          {error && <p role="alert" className="rounded-md bg-danger-light px-3 py-2 text-sm text-danger-dark">{error}</p>}
          <button className="btn btn-primary h-11 w-full" disabled={!complete || sending}>{sending ? 'Sending…' : 'Submit brief'}</button>
          <p className="text-center text-xs text-ink-3">Reference {form.ticketNumber}</p>
        </form>
      )}
    </PublicShell>
  );
}
