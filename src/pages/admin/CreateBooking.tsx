import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { usePageData, useData } from '../../context/DataContext';
import DetailsStep from '../../components/booking/DetailsStep';
import DataState from '../../components/ui/DataState';
import EmptyState from '../../components/ui/EmptyState';
import ReviewStep from '../../components/booking/ReviewStep';
import StepIndicator from '../../components/booking/StepIndicator';
import SlotPicker from '../../components/ui/SlotPicker';
import { toClientInput } from '../../lib/utils';
import { BLANK_CLIENT, EMAIL_PATTERN, type BookingMode, type BookingResult, type Client } from '../../types';

const STEPS = ['Client', 'Module', 'Details', 'Slot', 'Coordinator', 'Confirm'];
const MAX_MATCHES = 6;

/** Book a session on behalf of a client: client → module → details → slot → coordinator → confirm. Same endpoint as the public page. */
export default function CreateBooking() {
  const { clients, coordinators, modules, settings, mutate } = useData();
  const page = usePageData('clients');
  const navigate = useNavigate();
  // "+ Add Ticket" on a client's profile arrives here with that client already chosen.
  const preselected = (useLocation().state as { clientId?: string } | null)?.clientId ?? '';

  const [step, setStep] = useState(preselected ? 2 : 1);
  const [search, setSearch] = useState('');
  const [existingId, setExistingId] = useState(preselected); // '' = a new client, typed in step 3
  const [fresh, setFresh] = useState(BLANK_CLIENT);
  const [moduleId, setModuleId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<BookingMode>('online');
  const [startsAt, setStartsAt] = useState('');
  const [slotsKey, setSlotsKey] = useState(0); // changing it reloads the slots
  const [picked, setPicked] = useState<string | null>(null); // null = not touched yet, so the suggestion applies
  const [submitting, setSubmitting] = useState(false);

  const existing = clients.find((c) => c.id === existingId);
  const client = existing ? toClientInput(existing) : fresh;
  const module = modules.find((m) => m.id === moduleId);
  const active = coordinators.filter((c) => c.isActive);
  // The client's own coordinator is suggested; a booking still needs one chosen.
  const coordinatorId = picked ?? active.find((c) => c.id === existing?.assignedCoordinatorId)?.id ?? '';

  const query = search.trim().toLowerCase();
  const matches = query ? clients.filter((c) => [c.email, c.personName, c.companyName].join(' ').toLowerCase().includes(query)).slice(0, MAX_MATCHES) : [];

  const chooseClient = (chosen?: Client) => {
    setExistingId(chosen?.id ?? '');
    if (!chosen) setFresh({ ...BLANK_CLIENT, email: EMAIL_PATTERN.test(search.trim()) ? search.trim() : '' });
    setStep(2);
  };
  const chooseModule = (id: string) => {
    if (id !== moduleId) {
      setModuleId(id);
      setAnswers({});
      setStartsAt('');
    }
    setStep(3);
  };

  const confirm = async () => {
    setSubmitting(true);
    const result = await mutate<BookingResult>('/api/bookings', 'POST', { moduleId, startsAt, mode, coordinatorId, client, answers }, 'Booking created');
    if (result) return navigate(`/admin/tickets/${result.ticketId}`);
    // The time may have just been taken, so show a fresh list.
    setStartsAt('');
    setSlotsKey((key) => key + 1);
    setStep(4);
    setSubmitting(false);
  };

  const back = (to: number) => <button className="btn h-11" onClick={() => setStep(to)}>Back</button>;

  if (page.loading || page.error) return <DataState {...page}>{null}</DataState>;

  return (
    <div className="max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Create booking</h1>
          <p className="page-sub">{client.personName ? `Booking a session for ${client.personName}${client.companyName ? ` (${client.companyName})` : ''}.` : 'Book a session for a client.'} They receive the same confirmation email.</p>
        </div>
      </div>

      <div className="card p-6">
        <StepIndicator step={step} steps={STEPS} />

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="label">Find a client by email, name or company</label>
              <input className="input" autoFocus placeholder="client@company.com" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {matches.length > 0 && (
              <ul className="divide-y divide-line rounded-md border border-line">
                {matches.map((c) => (
                  <li key={c.id}>
                    <button className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-page" onClick={() => chooseClient(c)}>
                      <span><span className="font-medium">{c.personName}</span> <span className="text-ink-2">· {c.companyName}</span></span>
                      <span className="text-ink-2">{c.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query && matches.length === 0 && <p className="text-ink-2">No client found for "{search.trim()}".</p>}
            <button className="btn" onClick={() => chooseClient()}>+ New client{EMAIL_PATTERN.test(search.trim()) ? ` (${search.trim()})` : ''}</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {modules.every((m) => !m.isActive) && <EmptyState icon="calendar" message="No module is live yet" hint="Turn a module's booking page on in Settings > Modules." action={{ label: 'Open Settings', onClick: () => navigate('/admin/settings') }} />}
            <ul className="space-y-2">
              {modules.filter((m) => m.isActive).map((m) => (
                <li key={m.id}>
                  <button className="flex w-full items-center gap-3 rounded-md border border-line px-4 py-3 text-left hover:border-primary" onClick={() => chooseModule(m.id)}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
                    <span>
                      <span className="block font-medium">{m.name}</span>
                      {m.description && <span className="block text-ink-2">{m.description}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {back(1)}
          </div>
        )}

        {step === 3 && module && (
          <DetailsStep key={module.id} questions={module.questions} client={client} onClient={setFresh} answers={answers} onAnswers={setAnswers} lockClient={Boolean(existing)} onBack={() => setStep(2)} onNext={() => setStep(4)} />
        )}

        {step === 4 && module && (
          <div className="space-y-6">
            <SlotPicker key={`${module.slug}-${slotsKey}`} slug={module.slug} venue={settings.venue.address} mode={mode} onModeChange={setMode} startsAt={startsAt} onSelect={setStartsAt} />
            <div className="flex gap-3">
              {back(3)}
              <button className="btn btn-primary h-11 flex-1" disabled={!startsAt} onClick={() => setStep(5)}>Next</button>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div>
              <label className="label">Coordinator *</label>
              <select className="input" value={coordinatorId} onChange={(e) => setPicked(e.target.value)}>
                <option value="">Select a coordinator…</option>
                {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-3">Every booking made here needs a coordinator. A returning client's own coordinator is suggested.</p>
            </div>
            <div className="flex gap-3">
              {back(4)}
              <button className="btn btn-primary h-11 flex-1" disabled={!coordinatorId} onClick={() => setStep(6)}>Next</button>
            </div>
          </div>
        )}

        {step === 6 && module && (
          <div className="space-y-5">
            <ReviewStep
              module={{ ...module, venue: settings.venue.address }}
              client={client}
              answers={answers}
              mode={mode}
              startsAt={startsAt}
              coordinator={coordinators.find((c) => c.id === coordinatorId)?.name}
              titles={['Client details', 'Slot']}
              onEdit={(to) => setStep(to === 1 ? 3 : 4)}
            />
            <div className="flex gap-3">
              {back(5)}
              <button className="btn btn-primary h-11 flex-1" disabled={submitting} onClick={confirm}>{submitting ? 'Creating…' : 'Create Booking'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
