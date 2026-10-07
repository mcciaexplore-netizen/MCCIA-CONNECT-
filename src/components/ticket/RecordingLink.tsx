import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useData } from '../../context/DataContext';
import { recordingWanted } from '../../lib/utils';
import type { Booking } from '../../types';

interface Check {
  found: number;
  problem?: string;
}

const asked = new Set<string>(); // tickets already asked about since this page loaded (switching tabs must not ask again)

/**
 * A session's Fireflies recording: "Open recording" once it is saved. For an online session that is over and has none yet it asks Fireflies
 * once when the ticket is opened, and the button asks again on request (the recording appears a few minutes after the meeting ends).
 */
export default function RecordingLink({ ticketId, booking }: { ticketId: string; booking: Booking }) {
  const { mutate } = useData();
  const [working, setWorking] = useState(false);

  const check = async (force: boolean) => {
    setWorking(true);
    const result = await mutate<Check>('/api/tickets', 'POST', { action: 'fetch-recording', ticketId, force });
    setWorking(false);
    if (result?.found) toast.success('Recording and transcript saved from Fireflies');
    else if (force) toast(result?.problem ?? 'Fireflies has no recording of this session yet. Try again in a few minutes.');
  };

  const wanted = recordingWanted(booking, true);
  useEffect(() => {
    if (!wanted || asked.has(ticketId)) return;
    asked.add(ticketId);
    void check(false);
  }, [ticketId, wanted]); // eslint-disable-line react-hooks/exhaustive-deps

  if (booking.recordingLink) return <a className="btn btn-primary mt-0.5" href={booking.recordingLink} target="_blank" rel="noreferrer">Open recording</a>;
  if (!recordingWanted(booking)) return <>—</>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-ink-3">Not available yet</span>
      <button className="btn mt-0.5" disabled={working} onClick={() => check(true)}>{working ? 'Checking…' : 'Check Fireflies'}</button>
    </span>
  );
}
