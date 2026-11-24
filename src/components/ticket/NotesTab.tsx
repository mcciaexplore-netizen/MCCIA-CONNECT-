import { useState, type FormEvent } from 'react';
import { useData } from '../../context/DataContext';
import { formatDateTime } from '../../lib/utils';
import type { Ticket } from '../../types';
import Avatar from '../ui/Avatar';
import TranscriptNote from './TranscriptNote';

/** Staff-only notes, stored in tickets.internal_notes (newest first), and above them the session's Fireflies transcript once it is saved. */
export default function NotesTab({ ticket }: { ticket: Ticket }) {
  const { mutate, getSession } = useData();
  const booking = getSession(ticket.id)?.booking;
  const [note, setNote] = useState('');

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await mutate('/api/tickets', 'PATCH', { id: ticket.id, note }, 'Note added')) setNote('');
  };

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="card space-y-3">
        <textarea className="input" rows={3} placeholder="Add a note only staff can see…" required value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-primary">Add Note</button>
      </form>
      {booking?.recordingLink && <TranscriptNote ticketId={ticket.id} booking={booking} />}
      {ticket.internalNotes.length === 0 && !booking?.recordingLink && <p className="text-ink-2">No notes yet.</p>}
      <ul className="space-y-3">
        {[...ticket.internalNotes].reverse().map((entry) => (
          <li key={entry.at} className="card flex gap-3">
            <Avatar name={entry.author} size="sm" />
            <div className="min-w-0">
              <p className="font-medium">{entry.author} <span className="text-xs font-normal text-ink-3">{formatDateTime(entry.at)}</span></p>
              <p className="mt-1 whitespace-pre-line">{entry.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
