import { useState } from 'react';
import { useData } from '../../context/DataContext';
import type { Booking } from '../../types';

/** A booking's Google Meet link: "Join meeting" once it exists, otherwise (for a session still to come) a button to ask Google for it again. */
export default function MeetLink({ booking }: { booking: Booking }) {
  const { mutate } = useData();
  const [working, setWorking] = useState(false);

  if (booking.meetingLink) return <a className="btn btn-primary mt-0.5" href={booking.meetingLink} target="_blank" rel="noreferrer">Join meeting</a>;
  if (booking.mode !== 'online' || booking.status !== 'scheduled' || new Date(booking.endTime) < new Date()) return <>—</>;

  const create = async () => {
    setWorking(true);
    await mutate('/api/bookings', 'POST', { action: 'create-meet', bookingId: booking.id }, 'Meet link created');
    setWorking(false);
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-ink-3">Not created</span>
      <button className="btn mt-0.5" disabled={working} onClick={create}>{working ? 'Creating…' : 'Create Meet link'}</button>
    </span>
  );
}
