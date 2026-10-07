import { format } from 'date-fns';
import type { Session } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const WEEK_AHEAD = 7 * DAY;

/** A finished session whose coordinator has not filled in the post-consultation form (no-shows, reschedules and cancellations never need one). */
export const awaitingNotes = (s: Session, now: Date) =>
  s.booking.status !== 'cancelled' &&
  new Date(s.booking.endTime) <= now &&
  !['no_show', 'rescheduled'].includes(s.ticket.status) &&
  Object.keys(s.ticket.postConsultationData).length === 0;

/** The numbers both dashboards share, from the sessions the API returned (all of them for admins, only their own for coordinators). */
export function dayStats(sessions: Session[], now = new Date()) {
  const live = sessions.filter((s) => s.booking.status !== 'cancelled');
  const at = (s: Session) => new Date(s.booking.startTime);
  const today = live.filter((s) => format(at(s), 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd'));
  const todayWith = (status: string) => today.filter((s) => s.ticket.status === status).length;
  const tomorrowKey = format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), 'yyyy-MM-dd');
  return {
    live,
    today,
    tomorrow: live.filter((s) => format(at(s), 'yyyy-MM-dd') === tomorrowKey).length,
    pending: live.filter((s) => awaitingNotes(s, now)),
    upcoming: live.filter((s) => at(s) > now && at(s).getTime() - now.getTime() <= WEEK_AHEAD).length,
    completedThisMonth: sessions.filter((s) => s.ticket.status === 'completed' && format(at(s), 'yyyy-MM') === format(now, 'yyyy-MM')).length,
    completedToday: todayWith('completed'),
    noShowToday: todayWith('no_show'),
    rescheduledToday: todayWith('rescheduled'),
  };
}
