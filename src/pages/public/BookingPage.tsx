import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import PublicShell from '../../components/layout/PublicShell';
import CoordinatorConflict from '../../components/booking/CoordinatorConflict';
import DetailsStep from '../../components/booking/DetailsStep';
import ModuleUnavailable from '../../components/booking/ModuleUnavailable';
import ReviewStep from '../../components/booking/ReviewStep';
import StepIndicator from '../../components/booking/StepIndicator';
import EmptyState from '../../components/ui/EmptyState';
import SlotPicker from '../../components/ui/SlotPicker';
import { api, ApiError, errorMessage } from '../../lib/utils';
import { BLANK_CLIENT, type BookingConflict, type BookingMode, type BookingResult, type ClientInput, type DisabledModule, type PublicModule } from '../../types';

/** /book/:moduleSlug (public, no login): 1. Your Details → 2. Choose Slot → 3. Confirm. */
export default function BookingPage() {
  const { moduleSlug } = useParams();
  const navigate = useNavigate();
  const [module, setModule] = useState<PublicModule | null>(null);
  const [disabled, setDisabled] = useState<DisabledModule | null>(null); // the module is switched off
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [step, setStep] = useState(1);
  const [client, setClient] = useState<ClientInput>(BLANK_CLIENT);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<BookingMode>('online');
  const [startsAt, setStartsAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState<BookingConflict | null>(null); // the client's own coordinator is busy at that time

  const loadModule = useCallback(() => {
    setLoadError(null);
    api<PublicModule | DisabledModule>(`/api/modules?slug=${encodeURIComponent(moduleSlug ?? '')}`)
      .then((result) => ('disabled' in result ? setDisabled(result) : setModule(result)))
      .catch(setLoadError);
  }, [moduleSlug]);
  useEffect(loadModule, [loadModule]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  /** `coordinatorId`: the free coordinator the client chose after being told their own is busy (for this booking only). */
  const confirm = async (coordinatorId?: string) => {
    if (!module) return;
    setSubmitting(true);
    try {
      // One request does it all: client, booking, ticket, Excel row number, Calendar event + Meet link, emails.
      const result = await api<BookingResult | BookingConflict>('/api/bookings', { method: 'POST', anonymous: true, body: { moduleId: module.id, startsAt, mode, client, answers, ...(coordinatorId && { coordinatorId }) } });
      if ('coordinatorConflict' in result) {
        setConflict(result); // nothing was booked: offer who is free, or another time
        setSubmitting(false);
        return;
      }
      navigate(`/confirmed/${result.bookingId}`);
    } catch (e) {
      toast.error(errorMessage(e));
      if (e instanceof ApiError && e.status === 409) {
        // Someone took the slot first: back to the calendar, which reloads.
        setConflict(null);
        setStartsAt('');
        setStep(2);
      }
      setSubmitting(false);
    }
  };

  return (
    <PublicShell>
      {disabled ? (
        <ModuleUnavailable contactEmail={disabled.contactEmail} />
      ) : loadError ? (
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
                {conflict ? (
                  <CoordinatorConflict
                    key={conflict.availableCoordinators.map((c) => c.id).join()}
                    conflict={conflict}
                    busy={submitting}
                    onBook={confirm}
                    onOtherTime={() => {
                      setConflict(null);
                      setStartsAt('');
                      setStep(2);
                    }}
                  />
                ) : (
                  <button className="btn btn-primary h-12 w-full text-base" disabled={submitting} onClick={() => confirm()}>
                    {submitting ? 'Confirming…' : 'Confirm Booking'}
                  </button>
                )}
                {submitting && mode === 'online' && <p className="text-center text-xs text-ink-2">Setting up your Google Meet link. This can take a few seconds.</p>}
                <button className="w-full text-sm text-ink-2 hover:underline" disabled={submitting} onClick={() => { setConflict(null); setStep(2); }}>Back</button>
              </div>
            )}
          </div>
        </>
      )}
    </PublicShell>
  );
}
