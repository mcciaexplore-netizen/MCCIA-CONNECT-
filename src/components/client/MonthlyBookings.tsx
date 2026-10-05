import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns';
import type { Booking } from '../../types';

/** Sessions per month for the last 9 months, this month and the next 2 (cancelled bookings are not counted). */
export default function MonthlyBookings({ bookings }: { bookings: Booking[] }) {
  const data = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(startOfMonth(new Date()), i - 9);
    return { month: format(month, 'MMM yy'), bookings: bookings.filter((b) => b.status !== 'cancelled' && isSameMonth(new Date(b.startTime), month)).length };
  });

  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">Bookings per month</h2>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} width={24} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="bookings" fill="var(--primary)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
