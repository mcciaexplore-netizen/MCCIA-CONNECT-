import { STATUS_LABELS, type TicketStatus } from '../../types';

/** Pill badge. The colour pair per status lives in index.css as --status-<name>-bg / -text. */
export default function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: `var(--status-${status}-bg)`, color: `var(--status-${status}-text)` }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
