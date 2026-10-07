import { useEffect, useState } from 'react';
import { useData } from '../../context/DataContext';
import { formatDateTime } from '../../lib/utils';
import type { Booking } from '../../types';
import Avatar from '../ui/Avatar';

/** The Fireflies transcript of the session, shown with the internal notes. It is long, so it is read on its own when the tab opens. */
export default function TranscriptNote({ ticketId, booking }: { ticketId: string; booking: Booking }) {
  const { get } = useData();
  const [text, setText] = useState<string>(); // undefined while it loads
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    get<{ transcript: string | null }>(`/api/tickets?transcript=${ticketId}`)
      .then((answer) => current && setText(answer.transcript ?? ''))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [get, ticketId]);

  // Each run is "Speaker  m:ss" on one line and what they said below it.
  const runs = text?.split('\n\n').filter(Boolean) ?? [];
  return (
    <div className="card flex gap-3">
      <Avatar name="Fireflies" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Fireflies <span className="text-xs font-normal text-ink-3">Transcript of the session on {formatDateTime(booking.startTime)}</span></p>
        {failed ? (
          <p className="mt-1 text-ink-2">The transcript could not be loaded. Reload the page to try again.</p>
        ) : text === undefined ? (
          <p className="mt-1 text-ink-3">Loading transcript…</p>
        ) : runs.length === 0 ? (
          <p className="mt-1 text-ink-2">Fireflies did not hear anyone speak in this meeting.</p>
        ) : (
          <details className="mt-1" open={text.length < 1500}>
            <summary className="cursor-pointer text-primary">Show transcript</summary>
            <div className="mt-2 space-y-3">
              {runs.map((run, i) => {
                const [speaker, ...lines] = run.split('\n');
                return (
                  <p key={i}>
                    <span className="font-medium">{speaker}</span>
                    <br />
                    {lines.join('\n')}
                  </p>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
