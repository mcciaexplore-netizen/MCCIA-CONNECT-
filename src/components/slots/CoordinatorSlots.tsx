import type { Coordinator } from '../../types';
import AvailabilityForm from './AvailabilityForm';
import SlotCalendar from './SlotCalendar';

/** One coordinator's slot management: their own hours, and their week as free and booked slots. Their own page and the admin's view are the same. */
export default function CoordinatorSlots({ coordinator, own = false }: { coordinator: Coordinator; own?: boolean }) {
  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="mb-1 font-semibold">Hours</h2>
        <p className="mb-4 text-ink-2">When {own ? 'you' : coordinator.name} can be booked for a consultation. A slot also has to be open in the service itself.</p>
        <AvailabilityForm key={coordinator.id} coordinator={coordinator} />
      </section>
      <SlotCalendar coordinatorId={coordinator.id} version={coordinator.availability} />
    </div>
  );
}
