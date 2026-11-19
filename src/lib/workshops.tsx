import { formatDate } from './utils';
import { WORKSHOP_STATUS_LABELS, type Participant, type Workshop, type WorkshopStatus } from '../types';

/** The attendance column is free text (as in the sheet): this reads the usual answers. */
export const attended = (p: Participant) => /^(attend|present|yes|p$)/i.test(p.attendance?.trim() ?? '');

/** A YYYY-MM-DD date as the studio writes dates (noon UTC is the same day in every studio time zone). */
export const dayText = (date: string | null) => (date ? formatDate(`${date}T12:00:00Z`) : '');

/** "18 Nov 2026 · 10:30–12:30", or '' when the workshop has no date yet. */
export const workshopDate = (w: Workshop) => (w.heldOn ? `${dayText(w.heldOn)}${w.startTime ? ` · ${w.startTime}${w.endTime ? `–${w.endTime}` : ''}` : ''}` : '');

/** Status colours borrowed from the ticket statuses (index.css). */
const STATUS_COLOR: Record<WorkshopStatus, string> = { scheduled: 'new', completed: 'completed', cancelled: 'cancelled' };

export function WorkshopStatusPill({ status }: { status: WorkshopStatus }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `var(--status-${STATUS_COLOR[status]}-bg)`, color: `var(--status-${STATUS_COLOR[status]}-text)` }}>
      {WORKSHOP_STATUS_LABELS[status]}
    </span>
  );
}
