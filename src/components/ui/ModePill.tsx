import { cn } from '../../lib/utils';
import type { BookingMode } from '../../types';

export default function ModePill({ mode }: { mode: BookingMode }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', mode === 'online' ? 'bg-primary-light text-primary-dark' : 'bg-gold-light text-[#8a6d1c]')}>
      {mode === 'online' ? 'Online' : 'Offline'}
    </span>
  );
}
