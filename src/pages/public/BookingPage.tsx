import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import PublicShell from '../../components/layout/PublicShell';
import DetailsStep from '../../components/booking/DetailsStep';
import ReviewStep from '../../components/booking/ReviewStep';
import StepIndicator from '../../components/booking/StepIndicator';
import EmptyState from '../../components/ui/EmptyState';
import SlotPicker from '../../components/ui/SlotPicker';
import { api, ApiError, errorMessage } from '../../lib/utils';
import { BLANK_CLIENT, type BookingMode, type BookingResult, type ClientInput, type PublicModule } from '../../types';

/** /book/:moduleSlug (public, no login): 1. Your Details → 2. Choose Slot → 3. Confirm. */
export default function BookingPage() {
  const { moduleSlug } = useParams();
  const navigate = useNavigate();
  const [module, setModule] = useState<PublicModule | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [step, setStep] = useState(1);
  const [client, setClient] = useState<ClientInput>(BLANK_CLIENT);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<BookingMode>('online');
  const [startsAt, setStartsAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadModule = useCallback(() => {
    setLoadError(null);
    api<PublicModule>(`/api/modules?slug=${encodeURIComponent(moduleSlug ?? '')}`)
      .then(setModule)
      .catch(setLoadError);
  }, [moduleSlug]);
  useEffect(loadModule, [loadModule]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const confirm = async () => {
    if (!module) return;
    setSubmitting(true);
    try {
      // One request does it all: client, booking, ticket, Excel row number, Calendar event + Meet link, emails.
      const result = await api<BookingResult>('/api/bookings', { method: 'POST', anonymous: true, body: { moduleId: module.id, startsAt, mode, client, answers } });
      navigate(`/confirmed/${result.bookingId}`);
    } catch (e) {
      toast.error(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) {
        // Someone took the slot first: back to the calendar, which reloads.
        setStartsAt('');
        setStep(2);
      }
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      {loadError ? (
        <div className="card">
          {loadError instanceof ApiError && loadError.status === 404 ? (
            <EmptyState icon="calendar" message="This booking page does not exist" hint="Check the link you were given, or ask the studio for a new one." />
          ) : (
            <EmptyState icon="alert" message="Could not load this booking page" hint={errorMessage(loadError)} action={{ label: 'Retry', onClick: loadModule }} />
          )}
        </div>
      ) : !module ? (
        <p role="status" className="animate-pulse text-center text-ink-2">Loading…</p>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{module.name}</h1>
          {module.description && <p className="mb-5 mt-1 whitespace-pre-line text-ink-2">{module.description}</p>}

          <div className="card mt-5 p-6">
            <StepIndicator step={step} />

            {step === 1 && <DetailsStep questions={module.questions} client={client} onClient={setClient} answers={answers} onAnswers={setAnswers} onNext={() => setStep(2)} />}

            {step === 2 && (
              <div className="space-y-6">
                <SlotPicker slug={module.slug} venue={module.venue} mode={mode} onModeChange={setMode} startsAt={startsAt} onSelect={setStartsAt} />
                <div className="flex gap-3">
                  <button className="btn h-11" onClick={() => setStep(1)}>Back</button>
                  <button className="btn btn-primary h-11 flex-1" disabled={!startsAt} onClick={() => setStep(3)}>Next</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <ReviewStep module={module} client={client} answers={answers} mode={mode} startsAt={startsAt} onEdit={setStep} />
                <button className="btn btn-primary h-12 w-full text-base" disabled={submitting} onClick={confirm}>
                  {submitting ? 'Confirming…' : 'Confirm Booking'}
                </button>
                {submitting && mode === 'online' && <p className="text-center text-xs text-ink-2">Setting up your Google Meet link. This can take a few seconds.</p>}
                <button className="w-full text-sm text-ink-2 hover:underline" disabled={submitting} onClick={() => setStep(2)}>Back</button>
              </div>
            )}
          </div>
        </>
      )}
    </PublicShell>
  );
}
