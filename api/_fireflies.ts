import { and, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import { audit, db } from './_lib.js';
import { updateSheet } from './_live_excel.js';
import { errorText } from './_sessions.js';
import { bookings, tickets } from './_schema.js';
import { RECORDING_RECHECK_MINUTES, RECORDING_WINDOW_DAYS } from '../src/types/index.js';

/**
 * Fireflies (its bot joins our Google Meet sessions through the studio's calendar) keeps a recording and a transcript of each one.
 * We only read them: once an online session is over and Fireflies has transcribed it, its page is saved on the booking
 * (bookings.recording_link) and its transcript on the ticket (tickets.transcript). Needs FIREFLIES_API_KEY.
 */

const ENDPOINT = 'https://api.fireflies.ai/graphql';
const TIMEOUT_MS = 15_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SEARCH_MARGIN = 12 * HOUR; // Fireflies dates a recording by when the meeting began: look a little wider than the sessions' own hours
const SILENT_AFTER = 2 * HOUR; // a finished session where nobody spoke has no text; it still gets its link after this long
const MAX_LISTED = 50;

interface Listed {
  id: string;
  meeting_link: string | null;
  transcript_url: string | null;
  is_live: boolean | null;
}
interface Sentence {
  speaker_name: string | null;
  text: string;
  start_time: number;
}

async function ask<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.FIREFLIES_API_KEY}` },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const reply = (await response.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!response.ok || reply?.errors?.length || !reply?.data) throw new Error(`Fireflies: ${reply?.errors?.[0]?.message ?? `HTTP ${response.status}`}`);
  return reply.data;
}

/** A meeting link as a key for comparing ours with Fireflies': no scheme, query or trailing slash, lower case. */
const linkKey = (link: string) => link.toLowerCase().replace(/^https?:\/\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '');

const clock = (seconds: number) => {
  const total = Math.floor(seconds);
  const [hours, minutes] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60)];
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`;
};

/** The transcript as Fireflies shows it: each speaker's run of sentences under "Name  m:ss", runs separated by a blank line. */
export function formatTranscript(sentences: Sentence[]) {
  const runs: { speaker: string; at: number; text: string[] }[] = [];
  for (const { speaker_name, text, start_time } of sentences) {
    const speaker = speaker_name || 'Speaker';
    const last = runs[runs.length - 1];
    if (last?.speaker === speaker) last.text.push(text);
    else runs.push({ speaker, at: start_time, text: [text] });
  }
  return runs.map((run) => `${run.speaker}  ${clock(run.at)}\n${run.text.join(' ')}`).join('\n\n');
}

/** Online sessions that are over, not cancelled, whose recording has not been saved and can still turn up. */
const due = () =>
  and(
    eq(bookings.mode, 'online'),
    ne(bookings.status, 'cancelled'),
    isNotNull(bookings.meetingLink),
    isNull(bookings.recordingLink),
    lt(bookings.endTime, new Date()),
    gt(bookings.endTime, new Date(Date.now() - RECORDING_WINDOW_DAYS * DAY)),
  );

/**
 * Asks Fireflies for the recordings of the due sessions (just `bookingId` when given) and saves those that are ready. Never throws for
 * anything Fireflies-side: the answer says what happened ({ found, problem? }). Unless `force`, a session Fireflies was asked about in the last
 * RECORDING_RECHECK_MINUTES is left alone, so opening tickets cannot use up Fireflies' daily allowance of requests.
 */
export async function saveRecordings({ bookingId, force }: { bookingId?: string; force: boolean }): Promise<{ found: number; problem?: string }> {
  if (!process.env.FIREFLIES_API_KEY) return { found: 0, problem: 'Fireflies is not set up yet (FIREFLIES_API_KEY is missing)' };
  const rows = await db
    .select({ id: bookings.id, link: bookings.meetingLink, start: bookings.startTime, end: bookings.endTime, ticketId: tickets.id })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(and(due(), bookingId ? eq(bookings.id, bookingId) : undefined, force ? undefined : or(isNull(bookings.recordingCheckedAt), lt(bookings.recordingCheckedAt, new Date(Date.now() - RECORDING_RECHECK_MINUTES * MINUTE)))));
  if (!rows.length) return { found: 0 };
  await db.update(bookings).set({ recordingCheckedAt: new Date() }).where(inArray(bookings.id, rows.map((row) => row.id)));

  let found = 0;
  try {
    const from = new Date(Math.min(...rows.map((row) => row.start.getTime())) - SEARCH_MARGIN).toISOString();
    const to = new Date(Math.max(...rows.map((row) => row.end.getTime())) + SEARCH_MARGIN).toISOString();
    const { transcripts } = await ask<{ transcripts: Listed[] }>(`{ transcripts(fromDate: "${from}", toDate: "${to}", limit: ${MAX_LISTED}) { id meeting_link transcript_url is_live } }`);
    const byLink = new Map(transcripts.filter((t) => t.meeting_link && t.transcript_url).map((t) => [linkKey(t.meeting_link!), t]));

    for (const row of rows) {
      const listed = byLink.get(linkKey(row.link ?? ''));
      if (!listed || listed.is_live) continue; // not recorded (yet), or still being recorded
      const { transcript } = await ask<{ transcript: { sentences: Sentence[] | null } }>('query($id: String!) { transcript(id: $id) { sentences { speaker_name text start_time } } }', { id: listed.id });
      const sentences = transcript.sentences ?? [];
      if (!sentences.length && Date.now() - row.end.getTime() < SILENT_AFTER) continue; // Fireflies is probably still writing it up
      await db.batch([
        db.update(bookings).set({ recordingLink: listed.transcript_url }).where(eq(bookings.id, row.id)),
        db.update(tickets).set({ transcript: formatTranscript(sentences) }).where(eq(tickets.id, row.ticketId)),
      ]);
      await audit({ name: 'Fireflies', role: 'integration' }, 'booking.recording_saved', 'ticket', row.ticketId, undefined, { recordingLink: listed.transcript_url, words: sentences.reduce((n, s) => n + s.text.split(/\s+/).length, 0) });
      updateSheet([row.ticketId]); // the recording link goes to its row in the Excel sheet
      found++;
    }
  } catch (e) {
    console.error('Fireflies check failed:', e);
    return { found, problem: errorText(e) };
  }
  return { found };
}
