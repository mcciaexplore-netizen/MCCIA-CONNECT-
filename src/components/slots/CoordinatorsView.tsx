import { useState } from 'react';
import { useData } from '../../context/DataContext';
import { cn } from '../../lib/utils';
import Avatar from '../ui/Avatar';
import EmptyState from '../ui/EmptyState';
import CoordinatorSlots from './CoordinatorSlots';

/** The admin's view of everyone's slots: pick a coordinator, see (and change) their hours and their free and booked slots. */
export default function CoordinatorsView() {
  const { coordinators } = useData();
  const active = coordinators.filter((c) => c.isActive);
  const [id, setId] = useState('');
  const selected = active.find((c) => c.id === id) ?? active[0];

  if (!selected) {
    return (
      <div className="card">
        <EmptyState icon="user-group" message="No coordinators yet" hint="Add one under Team > Coordinators, then their slots show here." />
      </div>
    );
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {active.map((c) => (
          <button key={c.id} onClick={() => setId(c.id)} className={cn('btn gap-2', c.id === selected.id && 'border-primary bg-primary-light text-primary-dark')}>
            <Avatar name={c.name} color={c.color} size="sm" />
            {c.name}
          </button>
        ))}
      </div>
      <CoordinatorSlots key={selected.id} coordinator={selected} />
    </>
  );
}
